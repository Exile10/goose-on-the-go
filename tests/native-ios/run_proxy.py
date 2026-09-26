#!/usr/bin/env python3
"""Exercise native Apple proxy routing against the production Go CONNECT proxy.

The test-only Pondnet binding controls node lifecycle; it does not enroll with
Headscale. This macOS test does not prove mobile or iOS 16.4 proxy behavior.
"""
import base64
import hashlib
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[2]


def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs).stdout


def main():
    with tempfile.TemporaryDirectory(prefix="pond-apple-proxy-") as directory:
        scratch = Path(directory)
        run("openssl", "req", "-x509", "-sha256", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-pkeyopt", "ec_param_enc:named_curve", "-nodes",
            "-keyout", str(scratch / "key.pem"), "-out", str(scratch / "certificate.pem"), "-days", "1",
            "-subj", "/CN=pond", "-addext", "subjectAltName=IP:100.64.0.10", "-addext", "extendedKeyUsage=serverAuth", "-addext", "basicConstraints=CA:FALSE")
        # Reissue with the same key and an expired validity window, retaining IP SANs.
        (scratch / "index.txt").write_text("")
        (scratch / "serial").write_text("01\n")
        (scratch / "expiry.cnf").write_text(f"""[ca]
    default_ca = local
    [local]
    database = {scratch}/index.txt
    new_certs_dir = {scratch}
    serial = {scratch}/serial
    default_md = sha256
    policy = policy
    x509_extensions = extensions
    [policy]
    commonName = supplied
    [extensions]
    subjectAltName = IP:100.64.0.10
    extendedKeyUsage = serverAuth
    basicConstraints = CA:FALSE
    """)
        run("openssl", "req", "-new", "-key", str(scratch / "key.pem"), "-subj", "/CN=pond", "-out", str(scratch / "request.csr"))
        run("openssl", "ca", "-selfsign", "-batch", "-config", str(scratch / "expiry.cnf"),
            "-keyfile", str(scratch / "key.pem"), "-cert", str(scratch / "certificate.pem"),
            "-in", str(scratch / "request.csr"), "-out", str(scratch / "expired.pem"),
            "-startdate", "200101000000Z", "-enddate", "210101000000Z")
        public = run("openssl", "x509", "-in", str(scratch / "certificate.pem"), "-pubkey", "-noout")
        der = run("openssl", "pkey", "-pubin", "-outform", "DER", input=public)
        (scratch / "pin.txt").write_text("sha256/" + base64.b64encode(hashlib.sha256(der).digest()).decode())
        received = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                received.append(self.path)
                assert "X-Pond-Transport" not in self.headers
                assert "Proxy-Authorization" not in self.headers
                assert self.headers.get("Authorization") == "Bearer fixture-only"
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "/captured")
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream" if self.path == "/sse" else "text/plain")
                self.end_headers()
                self.wfile.write(b"data: first\n\n")
                self.wfile.flush()
                if self.path == "/sse":
                    time.sleep(0.1)
                    self.wfile.write(b"data: second\n\n")

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(scratch / "certificate.pem", scratch / "key.pem")
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            pond = Path(os.environ.get("POND_SOURCE_ROOT", ROOT.parent / "goose-in-a-pond"))
            subprocess.run(["go", "build", "-mod=readonly", "-o", str(scratch / "proxyfixture"), "./internal/proxyfixture"], cwd=pond / "native/pondnet", check=True)
            subprocess.run(["xcrun", "swiftc", "-swift-version", "5", "-emit-module", "-emit-library", "-module-name", "Pondnet",
                            str(ROOT / "tests/native-ios/PondnetFixture.swift"), "-o", str(scratch / "libPondnet.dylib")], cwd=scratch, check=True)
            subprocess.run(["xcrun", "swiftc", "-swift-version", "5", "-parse-as-library", "-I", directory, "-L", directory, "-lPondnet",
                            "-Xlinker", "-rpath", "-Xlinker", directory,
                            str(ROOT / "plugins/pond-tls/ios/PondCertificate.swift"),
                            str(ROOT / "plugins/pond-tls/ios/PondURLProtocol.swift"),
                            str(ROOT / "plugins/pond-tls/ios/PondNetwork.swift"),
                            str(ROOT / "tests/native-ios/ProxyTests.swift"), "-o", str(scratch / "test")], check=True)
            env = dict(os.environ, POND_PROXY_FIXTURE_BIN=str(scratch / "proxyfixture"),
                       POND_PROXY_FIXTURE_UPSTREAM=f"127.0.0.1:{server.server_port}")
            subprocess.run([str(scratch / "test"), directory], env=env, check=True, timeout=90)
            assert received == ["/fetch", "/xhr", "/sse", "/redirect", "/restored", "/preserved"], received
            print("PASS rejected requests sent no HTTP headers; proxy credentials stayed out of Pond HTTP")
            received.clear()
            context.load_cert_chain(scratch / "expired.pem", scratch / "key.pem")
            subprocess.run([str(scratch / "test"), directory, "expired"], env=env, check=True, timeout=90)
            assert not received, received
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
