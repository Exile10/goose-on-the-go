"""Disposable Headscale/DERP and enrollment fixture for the real mobile app.

The fixture CA is compiled through a Go overlay into temporary test artifacts.
Production sources, system trust stores and shipped network libraries are unchanged.
Run only through app_integration.py --embedded; Docker is required.
"""
import base64
import json
import os
from pathlib import Path
import re
import shutil
import shlex
import socket
import sqlite3
import subprocess
import time
import urllib.request


def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs).stdout


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def request(url, data=None, headers=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': 'application/json', **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as response:
        assert response.status == 200, response.status
        return json.load(response)


class EmbeddedFixture:
    def __init__(self, args, directory):
        self.args, self.directory = args, directory
        self.module = args.pond_root / 'native/pondnet'
        self.control_port, self.admin_port, self.enrollment_port = port(), port(), port()
        self.control = f'https://localhost:{self.control_port}'
        self.admin = f'http://127.0.0.1:{self.admin_port}'
        self.containers, self.processes, self.logs = [], [], []
        self.container_arguments = {}
        self.library = Path(__file__).resolve().parents[2] / 'native/pondnet' / (
            'pondnet.aar' if args.platform == 'android' else 'Pondnet.xcframework')
        self.backup = directory / self.library.name
        self.original_helper = os.environ.get('POND_NETWORK_BINARY')
        self.generated_library = self.library.parents[2] / 'android/app/libs/pondnet.aar'
        self.generated_backup = directory / 'generated-pondnet.aar'
        self.generated_bridge = self.library.parents[2] / 'android/app/src/main/java/io/jarida/pondtls/PondTls.kt'
        self.bridge_backup = directory / 'PondTls.kt'

    def command(self, *args, env=None, cwd=None):
        log = (self.directory / 'build.log').open('ab')
        try:
            subprocess.run(args, env=env, cwd=cwd, stdout=log, stderr=log, check=True)
        finally:
            log.close()

    def container(self, name, *args):
        run('docker', 'run', '-d', '--name', name, *args)
        self.containers.append(name)
        self.container_arguments[name] = args

    def prepare(self):
        self.directory.mkdir(mode=0o700)
        suffix = self.directory.parent.name.lower().replace('_', '-')[-20:]
        self.headscale = 'pond-app-headscale-' + suffix
        gateway = self.gateway = 'pond-app-gateway-' + suffix
        compose = (self.args.pond_root / 'deploy/remote-access/compose.yaml').read_text()
        images = re.findall(r'    image: (\S+)', compose)
        assert len(images) == 2 and all('@sha256:' in image for image in images)
        config = (self.args.pond_root / 'deploy/remote-access/headscale.example.yaml').read_text()
        (self.directory / 'headscale.yaml').write_text(config.replace('https://headscale.example.invalid', self.control))
        state = self.directory / 'headscale'
        state.mkdir()
        self.container(self.headscale, '-p', f'127.0.0.1:{self.admin_port}:8080',
                       '-v', f'{self.directory}/headscale.yaml:/etc/headscale/config.yaml:ro',
                       '-v', f'{state}:/var/lib/headscale', images[0], 'serve')
        for attempt in range(100):
            result = subprocess.run(['docker', 'exec', self.headscale, 'headscale', 'apikeys', 'create', '--expiration', '1h'], capture_output=True)
            if result.returncode == 0:
                self.credential = result.stdout.decode().strip()
                break
            time.sleep(.2)
        else:
            raise AssertionError('Fixture Headscale did not start')
        credential_file = self.directory / 'credential'
        credential_file.write_text(self.credential)
        credential_file.chmod(0o600)
        caddy = self.directory / 'caddy'
        caddy.mkdir()
        (self.directory / 'Caddyfile').write_text(f'''{{
  auto_https disable_redirects
}}
{self.control} {{
  tls internal
  handle /v1/approval {{
    reverse_proxy host.docker.internal:{self.enrollment_port}
  }}
  handle {{
    reverse_proxy host.docker.internal:{self.admin_port}
  }}
}}
''')
        self.container(gateway, '-p', f'127.0.0.1:{self.control_port}:{self.control_port}',
                       '-v', f'{self.directory}/Caddyfile:/etc/caddy/Caddyfile:ro',
                       '-v', f'{caddy}:/data', images[1])
        root = caddy / 'caddy/pki/authorities/local/root.crt'
        for _ in range(100):
            if root.exists():
                break
            time.sleep(.2)
        assert root.exists(), 'Fixture HTTPS root was not generated'
        # Go's overlay replaces source only inside these test builds. It cannot
        # introduce a fixture trust bypass into the normal native library.
        source = (self.module / 'node.go').read_text().replace('import (', 'import (\n "crypto/x509"\n "encoding/base64"', 1)
        source = source.replace('b, err := json.Marshal(s)', 'lc, e := n.Server.LocalClient()\n if e != nil { return "", e }\n ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second); defer cancel()\n full, e := lc.Status(ctx)\n if e != nil { return "", e }\n relayOnly := len(full.Peer) > 0\n for _, peer := range full.Peer { if peer.CurAddr != "" || peer.Relay != "goose" { relayOnly = false } }\n b, err := json.Marshal(struct { Status; FixtureRelayOnly bool `json:"fixtureRelayOnly"` }{s, relayOnly})')
        source += '''\nfunc init() {
 roots := x509.NewCertPool()
 pem, err := base64.StdEncoding.DecodeString("''' + base64.b64encode(root.read_bytes()).decode() + '''")
 if err != nil || !roots.AppendCertsFromPEM(pem) { panic("invalid local test CA") }
 os.Setenv("GODEBUG", "x509usefallbackroots=1")
 x509.SetFallbackRoots(roots)
 envknob.Setenv("TS_DEBUG_TLS_DIAL", "true")
 envknob.Setenv("TS_DEBUG_NEVER_DIRECT_UDP", "true")
}
'''
        replacement = self.directory / 'node.go'
        replacement.write_text(source)
        overlay = self.directory / 'overlay.json'
        bridge_source = (self.module / 'bridge.go').read_text()
        # Each certificate variant must receive a fresh handshake, not a ticket
        # authenticated against the previously valid certificate.
        bridge_source = bridge_source.replace('&tls.Config{MinVersion:', '&tls.Config{SessionTicketsDisabled: true, MinVersion:')
        alternate = json.dumps(str(self.directory / 'alternate-identity.json'))
        bridge_source = bridge_source.replace('func LoadCertificate(path string) (*tls.Certificate, error) {',
            'func LoadCertificate(path string) (*tls.Certificate, error) {\n if _, err := os.Stat(' + alternate + '); err == nil { path = ' + alternate + ' }')
        redirect = 'if r.URL.Path == "/api/v1/fixture-redirect" { http.Redirect(w, r, "/api/v1/fixture-captured", http.StatusFound); return }; '
        captured = json.dumps(str(self.directory / 'redirect-captured'))
        redirect += 'if r.URL.Path == "/api/v1/fixture-captured" { os.WriteFile(' + captured + ', []byte("reached"), 0600); w.WriteHeader(200); return }; '
        bridge_source = bridge_source.replace('proxy.ServeHTTP(w, r)', redirect + 'proxy.ServeHTTP(w, r)')
        bridge_replacement = self.directory / 'bridge.go'
        bridge_replacement.write_text(bridge_source)
        overlay.write_text(json.dumps({'Replace': {str(self.module / 'node.go'): str(replacement), str(self.module / 'bridge.go'): str(bridge_replacement)}}))
        env = {**os.environ, 'GOFLAGS': f'-overlay={overlay}', 'GOMAXPROCS': '3'}
        self.helper = self.directory / 'pondnet'
        self.enrollment = self.directory / 'pond-enrollment'
        self.command('go', 'build', '-o', str(self.helper), './cmd/pondnet', cwd=self.module, env=env)
        self.command('go', 'build', '-o', str(self.enrollment), './cmd/pond-enrollment', cwd=self.module, env=env)
        tools = self.directory / 'tools'
        tools.mkdir()
        self.command('go', 'build', '-o', str(tools / 'gobind'), 'golang.org/x/mobile/cmd/gobind', cwd=self.module)
        self.command('go', 'build', '-o', str(tools / 'gomobile'), 'golang.org/x/mobile/cmd/gomobile', cwd=self.module)
        # Apple gomobile replaces GOFLAGS with its platform tags. Reapply the
        # fixture overlay at the actual Go invocation, including nested builds.
        real_go = shutil.which('go')
        assert real_go
        wrapper = tools / 'go'
        wrapper.write_text('#!/bin/sh\nexport GOFLAGS="${GOFLAGS:-} -overlay=' + str(overlay) + '"\nexec ' + shlex.quote(real_go) + ' "$@"\n')
        wrapper.chmod(0o700)
        env['PATH'] = str(tools) + os.pathsep + env['PATH']
        artifacts = self.directory / 'artifacts'
        artifacts.mkdir()
        artifact = artifacts / self.library.name
        target = ['-target=android/arm64', '-androidapi=24', '-ldflags=-extldflags=-Wl,-z,max-page-size=16384', '-javapkg=io.jarida'] if self.args.platform == 'android' else ['-target=iossimulator', '-iosversion=16.4']
        self.command(str(tools / 'gomobile'), 'bind', *target, '-o', str(artifact), './mobile', cwd=self.module, env=env)
        if self.args.platform == 'ios':
            libraries = list(artifact.glob('*/Pondnet.framework/Pondnet'))
            marker = base64.b64encode(root.read_bytes())
            assert libraries and all(marker in library.read_bytes() for library in libraries), 'Fixture CA missing from Apple native library'
        shutil.move(self.library, self.backup)
        shutil.move(artifact, self.library)
        if self.args.platform == 'android':
            shutil.copy2(self.generated_library, self.generated_backup)
            shutil.copy2(self.library, self.generated_library)
            shutil.copy2(self.generated_bridge, self.bridge_backup)
            diagnostic = self.generated_bridge.read_text().replace('catch (_: Exception) { promise.reject("pond_remote_unavailable", "Remote access operation failed") }', 'catch (error: Exception) { promise.reject("pond_remote_unavailable", "Fixture startup: " + error.toString()) }')
            self.generated_bridge.write_text(diagnostic)
        os.environ['POND_NETWORK_BINARY'] = str(self.helper)
        print('Prepared isolated Headscale, forced DERP and fixture-only native library', flush=True)

    def approve_pond(self, http_port, https_port):
        local = f'http://127.0.0.1:{http_port}'
        identity = request(local + '/api/v1/remote-access/identity', {})
        user = request(self.admin + '/api/v1/user', {'name': 'app-' + self.directory.name[-12:]},
                       {'Authorization': 'Bearer ' + self.credential})['user']['id']
        state = self.directory / 'enrollment'
        self.command(str(self.enrollment), '--state', str(state), '--provision', identity['household'],
                     '--public-key', identity['publicKey'], '--user-id', str(user), '--https-port', str(https_port))
        log = (self.directory / 'enrollment.log').open('wb')
        self.logs.append(log)
        process = subprocess.Popen([str(self.enrollment), '--state', str(state), '--listen', f'127.0.0.1:{self.enrollment_port}',
                                    '--headscale', self.admin, '--credential-file', str(self.directory / 'credential')], stdout=log, stderr=log)
        self.processes.append(process)
        time.sleep(.3)
        assert process.poll() is None
        request(local + '/api/v1/remote-access', {'enabled': True, 'controlUrl': self.control, 'enrollmentUrl': self.control})
        for _ in range(100):
            if request(local + '/api/v1/remote-access').get('authUrl'):
                break
            time.sleep(.2)
        else:
            raise AssertionError('Pond did not offer a pending registration')
        request(local + '/api/v1/remote-access/register', {})
        for _ in range(200):
            info = request(local + '/api/v1/system/info')
            if info.get('tailnet_address'):
                self.remote = f"https://{info['tailnet_address']}:{https_port}"
                self.prepare_certificates(info['tailnet_address'])
                print('Scratch Pond registered and certificate covers its embedded address', flush=True)
                return
            time.sleep(.2)
        raise AssertionError('Embedded Pond listener did not become ready')

    def prepare_certificates(self, address):
        identity = json.loads((self.directory.parent / 'pond/tls/identity.json').read_text())
        key = self.directory / 'pond-key.pem'
        key.write_text(identity['key_pem']); key.chmod(0o600)
        self.identities = {}
        for mode, san in [('renewed', 'IP:' + address), ('hostname', 'DNS:incorrect.invalid')]:
            cert = self.directory / (mode + '.pem')
            run('openssl', 'req', '-new', '-x509', '-sha256', '-key', str(key), '-out', str(cert),
                '-days', '365', '-subj', '/CN=pond', '-addext', 'subjectAltName=' + san,
                '-addext', 'extendedKeyUsage=serverAuth', '-addext', 'basicConstraints=CA:FALSE')
            self.identities[mode] = {'key_pem': identity['key_pem'], 'cert_pem': cert.read_text()}
        (self.directory / 'index').write_text('')
        (self.directory / 'serial').write_text('01\n')
        config = self.directory / 'expired.cnf'
        config.write_text(f"""[ca]
default_ca = local
[local]
database = {self.directory}/index
new_certs_dir = {self.directory}
serial = {self.directory}/serial
default_md = sha256
policy = policy
x509_extensions = extensions
[policy]
commonName = supplied
[extensions]
subjectAltName = IP:{address}
extendedKeyUsage = serverAuth
basicConstraints = CA:FALSE
""")
        csr = self.directory / 'pond.csr'
        run('openssl', 'req', '-new', '-key', str(key), '-subj', '/CN=pond', '-out', str(csr))
        expired = self.directory / 'expired.pem'
        run('openssl', 'ca', '-selfsign', '-batch', '-config', str(config), '-keyfile', str(key),
            '-cert', str(self.directory / 'renewed.pem'), '-in', str(csr), '-out', str(expired),
            '-startdate', '200101000000Z', '-enddate', '210101000000Z')
        self.identities['expired'] = {'key_pem': identity['key_pem'], 'cert_pem': expired.read_text()}
        original_public = run('openssl', 'pkey', '-in', str(key), '-pubout', '-outform', 'DER')
        for material in self.identities.values():
            public = run('openssl', 'x509', '-pubkey', '-noout', input=material['cert_pem'].encode())
            assert run('openssl', 'pkey', '-pubin', '-outform', 'DER', input=public) == original_public

    def certificate(self, mode):
        destination = self.directory / 'alternate-identity.json'
        if mode == 'original':
            destination.unlink(missing_ok=True)
            return
        assert mode in self.identities
        temporary = self.directory / 'alternate-identity.tmp'
        temporary.write_text(json.dumps(self.identities[mode])); temporary.chmod(0o600)
        temporary.replace(destination)

    def restore_backup(self):
        # Exercise the documented consistent stop/copy/restore order against
        # disposable volumes while both mobile and Pond nodes retain identity.
        backup = self.directory / 'restore-snapshot'
        assert not backup.exists(), 'This fixture restore is single-use'
        run('docker', 'stop', self.gateway)
        previous = self.processes[0]
        previous.terminate()
        previous.wait(timeout=15)
        run('docker', 'stop', self.headscale)
        backup.mkdir(mode=0o700)
        restored = self.directory / 'restored-volumes'
        restored.mkdir(mode=0o700)
        for name in ('headscale', 'enrollment', 'caddy'):
            shutil.copytree(self.directory / name, backup / name)
            shutil.copytree(backup / name, restored / name)
        # Restore into fresh paths, matching the deployment procedure. Replacing
        # files beneath a reused Docker Desktop bind mount can retain stale inodes.
        connection = sqlite3.connect(str(restored / 'headscale/db.sqlite'))
        try:
            assert connection.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
        finally:
            connection.close()
        for name in (self.headscale, self.gateway):
            run('docker', 'rm', name)
            self.container_arguments[name] = tuple(
                arg.replace(str(self.directory / 'headscale') + ':', str(restored / 'headscale') + ':')
                   .replace(str(self.directory / 'caddy') + ':', str(restored / 'caddy') + ':')
                for arg in self.container_arguments[name])
        run('docker', 'run', '-d', '--name', self.headscale, *self.container_arguments[self.headscale])
        credential_headers = {'Authorization': 'Bearer ' + self.credential}
        for _ in range(100):
            try:
                request(self.admin + '/api/v1/user', headers=credential_headers)
                break
            except (OSError, ValueError):
                time.sleep(.2)
        else:
            raise AssertionError('Restored Headscale failed its authenticated health check')
        log = (self.directory / 'enrollment.log').open('ab')
        self.logs.append(log)
        restored_args = [str(restored / 'enrollment') if arg == str(self.directory / 'enrollment') else arg for arg in previous.args]
        process = subprocess.Popen(restored_args, stdout=log, stderr=log)
        self.processes[0] = process
        for _ in range(100):
            assert process.poll() is None, 'Restored enrollment service exited'
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{self.enrollment_port}/health', timeout=2) as response:
                    assert response.status == 200
                break
            except OSError:
                time.sleep(.2)
        else:
            raise AssertionError('Restored enrollment service did not become healthy')
        run('docker', 'run', '-d', '--name', self.gateway, *self.container_arguments[self.gateway])

    def outage(self, active):
        # Stop the fixture's shared coordinator/DERP gateway. This closes existing
        # relay streams as well as refusing new registrations; no host networking
        # or production service is changed.
        run('docker', 'stop' if active else 'start', self.gateway)

    def assert_redirect_blocked(self):
        assert not (self.directory / 'redirect-captured').exists(), 'Embedded redirect reached its destination'

    def close(self):
        for process in self.processes:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for log in self.logs:
            log.close()
        for name in reversed(self.containers):
            subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
        if self.backup.exists():
            if self.library.is_dir():
                shutil.rmtree(self.library)
            else:
                self.library.unlink(missing_ok=True)
            shutil.move(self.backup, self.library)
        if self.generated_backup.exists():
            shutil.copy2(self.generated_backup, self.generated_library)
        if self.bridge_backup.exists():
            shutil.copy2(self.bridge_backup, self.generated_bridge)
        if self.original_helper is None:
            os.environ.pop('POND_NETWORK_BINARY', None)
        else:
            os.environ['POND_NETWORK_BINARY'] = self.original_helper
