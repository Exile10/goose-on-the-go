/** Alternate native test bundle entry. The production app never imports this file. */
import React, { useEffect, useState } from 'react';
import { AppState, Text, ScrollView, Platform, NativeModules } from 'react-native';
import { registerRootComponent } from 'expo';
import * as FixtureSecureStore from 'expo-secure-store';
import { useKeepAwake } from 'expo-keep-awake';
import { fetch as expoFetch } from 'expo/fetch';
import { configurePondTrust } from '@/services/pond-trust';
import { NotificationStream } from '@/services/notification-stream';
import { commitPairedProfile, loadPairedProfile, type SavedPond } from '@/services/paired-profile';
import { SecureStorage } from '@/services/secure-storage';
import { api, PondApiClient } from '@/services/api-client';
import { enableRemoteAccess } from '@/services/remote-access';

const origin = process.env.EXPO_PUBLIC_POND_TEST_ORIGIN ?? '';
const pin = process.env.EXPO_PUBLIC_POND_TEST_PIN ?? '';
const expiredOrigin = process.env.EXPO_PUBLIC_POND_TEST_EXPIRED_ORIGIN ?? '';
const incorrect = `sha256/${'A'.repeat(43)}=`;
const headers = { 'X-Pond-Transport': '1', Authorization: 'Bearer scratch-fixture' };
interface Result { name: string; passed: boolean; error?: string }
const results: Result[] = [];
function assert(value: unknown, reason: string): asserts value { if (!value) throw new Error(reason); }

async function check(name: string, action: () => Promise<void>) {
  try { await action(); results.push({ name, passed: true }); console.info(`[native-test] PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: String(error) }); console.warn(`[native-test] FAIL ${name}`); }
}
async function rejected(action: () => Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      action().then(() => 'accepted', () => 'rejected'),
      new Promise<string>((resolve) => { timer = setTimeout(() => resolve('timeout'), 10_000); }),
    ]);
    assert(result === 'rejected', result === 'timeout' ? 'Native request did not reject within 10 seconds' : 'Request unexpectedly succeeded');
  } finally { if (timer) clearTimeout(timer); }
}

function xhr(path: string, base = origin): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', base + path);
    Object.entries(headers).forEach(([key, value]) => request.setRequestHeader(key, value));
    request.timeout = 5000;
    request.onload = () => request.status === 200 ? resolve(request.responseText) : reject(new Error(`HTTP ${request.status}`));
    request.onerror = () => reject(new Error('XHR transport rejected'));
    request.ontimeout = () => reject(new Error('XHR timed out'));
    request.send();
  });
}

async function waitForRemote(remote: string): Promise<void> {
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      const response = await expoFetch(remote + '/api/v1/health', { headers, signal: AbortSignal.timeout(1500) });
      if (response.status === 200) return;
    } catch { /* The peer map and relay reconnect asynchronously. */ }
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Remote HTTPS did not recover within its bounded deadline');
}

async function remoteStream(remote: string, token: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = new XMLHttpRequest();
    const timeout = setTimeout(() => { stream.abort(); reject(new Error('Restored SSE timed out')); }, 25_000);
    stream.open('GET', remote + `/api/v1/notifications/stream?device_id=${Platform.OS}-scratch-phone`);
    stream.setRequestHeader('X-Pond-Transport', '1');
    stream.setRequestHeader('Authorization', `Bearer ${token}`);
    stream.onprogress = () => {
      if (stream.status === 200 && stream.responseText.length > 0) { clearTimeout(timeout); stream.abort(); resolve(); }
    };
    stream.onerror = () => { clearTimeout(timeout); reject(new Error('Restored SSE failed')); };
    stream.send();
  });
}

async function run(): Promise<Result[]> {
  assert(origin.startsWith('https://127.0.0.1:'), 'Only the local native test fixture is allowed');
  await configurePondTrust([{ url: origin, pin }]);
  let previous = await loadPairedProfile();
  // Simulator Keychain items can survive uninstall; discard only a prior test run's identity.
  if (previous.saved && ['simulator-fixture', 'native-fixture'].includes(previous.saved.identity.id) && previous.saved.identity.pin !== pin) {
    await SecureStorage.remove('pondIdentity');
    await FixtureSecureStore.deleteItemAsync('fixture.remote');
    previous = { saved: null, upgrade: false };
  }
  if (previous.saved) {
    await check('secure profile survives app restart', async () => {
      assert(previous.saved?.identity.pin === pin && previous.saved.identity.session === 'scratch-fixture', 'Restored identity differs');
      const response = await expoFetch(origin + '/restart', { headers });
      assert(response.status === 200, 'Restored trust cannot connect');
    });
    const persisted = await FixtureSecureStore.getItemAsync('fixture.remote');
    if (persisted) await check('embedded identity and authenticated REST/SSE survive process restart', async () => {
      const saved = JSON.parse(persisted) as { remote: string; control: string; pin: string; token: string; machineKey: string; nodeKey: string };
      await configurePondTrust([{ url: origin, pin }, { url: saved.remote, pin: saved.pin }]);
      await NativeModules.PondTls.activateRemote('replacement-app-fixture', saved.control);
      await waitForRemote(saved.remote);
      const current = JSON.parse(await NativeModules.PondTls.remoteStatus());
      assert(current.machineKey === saved.machineKey && current.nodeKey === saved.nodeKey, 'Process restart replaced the native identity');
      const response = await expoFetch(saved.remote + '/api/v1/devices', { headers: { ...headers, Authorization: `Bearer ${saved.token}` } });
      assert(response.status === 200, 'Restored credentials cannot access authenticated REST');
      await remoteStream(saved.remote, saved.token);
      await NativeModules.PondTls.disableRemote();
      await FixtureSecureStore.deleteItemAsync('fixture.remote');
    });
  } else {
    await check('Expo fetch uses pinned native transport', async () => {
      const response = await expoFetch(origin + '/fetch', { headers });
      assert(response.status === 200 && await response.text() === 'ok', 'Fetch response differs');
    });
    await check('React Native XHR uses pinned native transport', async () => { assert(await xhr('/xhr') === 'ok', 'XHR response differs'); });
    await check('notification SSE is incremental and deduplicated', async () => {
      await new Promise<void>((resolve, reject) => {
        const ids: string[] = [];
        const timeout = setTimeout(() => { stream.stop(); reject(new Error('SSE timed out')); }, 5000);
        const stream = new NotificationStream({ baseUrl: origin, deviceId: 'scratch-phone', token: 'scratch-fixture',
          onNotification: (notification) => {
            ids.push(notification.id);
            if (notification.id === 'second') {
              clearTimeout(timeout); stream.stop();
              if (ids.join(',') === 'first,second') resolve(); else reject(new Error('Duplicate notification escaped'));
            }
          },
          onDisconnect: () => { clearTimeout(timeout); stream.stop(); reject(new Error('SSE disconnected')); },
        });
        stream.start();
      });
    });
    await configurePondTrust([{ url: origin, pin: incorrect }]);
    await check('wrong pin blocks Expo fetch before HTTP', () => rejected(() => expoFetch(origin + '/wrong-fetch', { headers })));
    await check('wrong pin blocks XHR before HTTP', () => rejected(() => xhr('/wrong-xhr')));
    await check('wrong pin blocks the notification stream', async () => {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { stream.stop(); reject(new Error('Wrong-pin SSE did not reject')); }, 5000);
        const stream = new NotificationStream({ baseUrl: origin, deviceId: 'wrong-pin-phone', token: 'scratch-fixture',
          onNotification: () => { clearTimeout(timeout); stream.stop(); reject(new Error('Wrong-pin SSE received data')); },
          onDisconnect: () => { clearTimeout(timeout); stream.stop(); resolve(); },
        });
        stream.start();
      });
    });
    const hostname = origin.replace('127.0.0.1', 'localhost');
    await configurePondTrust([{ url: hostname, pin }, { url: origin, pin }]);
    await check('hostname mismatch is rejected', () => rejected(() => expoFetch(hostname + '/wrong-host', { headers })));
    await check('XHR hostname mismatch is rejected', () => rejected(() => xhr('/wrong-host-xhr', hostname)));
    await configurePondTrust([{ url: origin, pin }, { url: expiredOrigin, pin }]);
    await check('expired certificate blocks Expo fetch', () => rejected(() => expoFetch(expiredOrigin + '/expired-fetch', { headers })));
    await check('expired certificate blocks XHR', () => rejected(() => xhr('/expired-xhr', expiredOrigin)));
    await check('redirect is rejected before destination request', () => rejected(() => expoFetch(origin + '/redirect', { headers })));
    await check('immediate plaintext rejection remains reliable across repeated requests', async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        await rejected(() => expoFetch(origin.replace('https:', 'http:') + '/plaintext', { headers }));
      }
    });
    await configurePondTrust([]);
    await check('cleared trust blocks retained clients', () => rejected(() => xhr('/cleared')));
    await configurePondTrust([{ url: origin, pin }]);
    await check('secure profile commits atomically', async () => {
      const saved: SavedPond = { identity: { id: 'native-fixture', pin, session: 'scratch-fixture', refresh: 'scratch-refresh' },
        profile: { version: 2, host: '127.0.0.1', port: Number(new URL(origin).port), localUrls: [origin] } };
      await commitPairedProfile(null, saved);
      assert((await loadPairedProfile()).saved?.identity.pin === pin, 'Secure profile was not saved');
      assert(await SecureStorage.get('pondIdentity'), 'SecureStore is unavailable');
    });
    await check('background and foreground preserve pinned transport', async () => {
      await new Promise<void>((resolve, reject) => {
        let background = false;
        const timeout = setTimeout(() => { subscription.remove(); reject(new Error('AppState resume timed out')); }, 15_000);
        const subscription = AppState.addEventListener('change', (state) => {
          if (state === 'background') background = true;
          if (background && state === 'active') {
            clearTimeout(timeout); subscription.remove(); resolve();
          }
        });
        void expoFetch(origin + '/lifecycle-ready', { headers }).catch((error) => {
          clearTimeout(timeout); subscription.remove(); reject(error);
        });
      });
      assert((await expoFetch(origin + '/resumed', { headers })).status === 200, 'Pinned transport failed after resume');
    });
    await check('real scratch Pond pairing, authenticated REST, refresh and SSE', async () => {
      const configResponse = await expoFetch(origin + '/pond-config', { headers });
      const pond = await configResponse.json() as { url: string; pin: string; code: string; remote?: string; control?: string };
      await configurePondTrust([{ url: origin, pin }, { url: pond.url, pin: pond.pin }]);
      const client = new PondApiClient(pond.url);
      const paired = await client.pair({ clientId: `${Platform.OS}-scratch-phone`, pairingCode: pond.code, deviceName: `${Platform.OS} transport verification` });
      assert(paired.accepted && paired.session_token, 'Scratch Pond pairing failed');
      const refreshed = await client.handshakeRefresh();
      assert(refreshed?.accepted && refreshed.session_token, 'Scratch Pond refresh failed');
      const authorization = `Bearer ${refreshed.session_token}`;
      const response = await expoFetch(pond.url + '/api/v1/devices', { headers: { ...headers, Authorization: authorization } });
      assert(response.status === 200, `Authenticated REST failed: HTTP ${response.status} ${await response.text()}`);
      await new Promise<void>((resolve, reject) => {
        const stream = new XMLHttpRequest();
        const timeout = setTimeout(() => { stream.abort(); reject(new Error('Scratch Pond SSE timed out')); }, 25_000);
        stream.open('GET', pond.url + `/api/v1/notifications/stream?device_id=${Platform.OS}-scratch-phone`);
        stream.setRequestHeader('X-Pond-Transport', '1');
        stream.setRequestHeader('Authorization', authorization);
        stream.onprogress = () => {
          if (stream.status === 200 && stream.responseText.length > 0) { clearTimeout(timeout); stream.abort(); resolve(); }
        };
        stream.onerror = () => { clearTimeout(timeout); reject(new Error('Scratch Pond SSE failed')); };
        stream.send();
      });
      if (pond.remote && pond.control) {
        const remote = pond.remote;
        const control = pond.control;
        const trusted = [{ url: origin, pin }, { url: pond.url, pin: pond.pin }, { url: remote, pin: pond.pin }];
        api.setBaseUrl(pond.url); api.setToken(refreshed.session_token);
        await check('explicit activation enrolls through the paired Pond and Headscale', async () => {
          await enableRemoteAccess('headscale-app-fixture', pond.url, () => {}, async (endpoint, coordinator, current) => {
            current(); assert(endpoint === remote && coordinator === control, 'Authenticated remote configuration differs');
            await configurePondTrust(trusted);
            await NativeModules.PondTls.activateRemote('headscale-app-fixture', control);
            current();
          });
          assert(JSON.parse(await NativeModules.PondTls.remoteStatus()).state === 'Running', 'Embedded node is not running');
        });
        assert(JSON.parse(await NativeModules.PondTls.remoteStatus()).state === 'Running', 'Skip dependent checks: embedded activation failed');
        let remoteSession = refreshed.session_token;
        const remoteHeaders = { ...headers, Authorization: authorization };
        await check('embedded Expo fetch reaches the authenticated Pond through DERP', async () => {
          const response = await expoFetch(remote + '/api/v1/devices', { headers: remoteHeaders });
          assert(response.status === 200, `Embedded REST failed: ${response.status}`);
        });
        await check('embedded traffic uses the Goose relay without a direct peer route', async () => {
          const state = JSON.parse(await NativeModules.PondTls.remoteStatus());
          assert(state.fixtureRelayOnly === true, 'The fixture did not confirm relay-only routing');
        });
        await check('embedded XHR SSE reaches the private companion bridge', async () => {
          await new Promise<void>((resolve, reject) => {
            const stream = new XMLHttpRequest();
            const timeout = setTimeout(() => { stream.abort(); reject(new Error('Embedded SSE timed out')); }, 25_000);
            stream.open('GET', remote + `/api/v1/notifications/stream?device_id=${Platform.OS}-scratch-phone`);
            Object.entries(remoteHeaders).forEach(([key, value]) => stream.setRequestHeader(key, value));
            stream.onprogress = () => {
              if (stream.status === 200 && stream.responseText.length > 0) { clearTimeout(timeout); stream.abort(); resolve(); }
            };
            stream.onerror = () => { clearTimeout(timeout); reject(new Error('Embedded SSE rejected')); };
            stream.send();
          });
        });
        await check('embedded bridge refuses remote pairing and forged local identity', async () => {
          const challenge = await client.handshakeInit({ clientId: 'pending-local-challenge' });
          for (const [path, body] of [
            ['/api/v1/handshake/init', { client_id: 'remote-attempt', client_type: 'gotg', client_version: 'test' }],
            ['/api/v1/handshake/verify', { challenge_id: challenge.challenge_id, mac: '00'.repeat(32) }],
          ] as const) {
            const response = await expoFetch(remote + path, { method: 'POST', headers: {
              ...remoteHeaders, 'Content-Type': 'application/json', 'X-Forwarded-For': '127.0.0.1', 'X-Pond-Embedded-Peer': '127.0.0.1:1234',
            }, body: JSON.stringify(body) });
            assert(response.status === 403, `Remote pairing was not denied: ${response.status}`);
            assert((await response.json()).error === 'pairing_requires_lan', 'Remote pairing error differs');
          }
        });
        await check('authorized refresh succeeds through embedded networking', async () => {
          client.setBaseUrl(remote);
          const result = await client.handshakeRefresh();
          assert(result?.accepted && result.session_token, 'Remote refresh failed');
          api.setToken(result.session_token);
          remoteSession = result.session_token;
        });
        await configurePondTrust(trusted.map((entry) => entry.url === remote ? { ...entry, pin: incorrect } : entry));
        await check('embedded wrong pin rejects Expo fetch', () => rejected(() => expoFetch(remote + '/api/v1/health', { headers })));
        await check('embedded wrong pin rejects XHR SSE', async () => {
          await new Promise<void>((resolve, reject) => {
            const stream = new XMLHttpRequest();
            stream.open('GET', remote + `/api/v1/notifications/stream?device_id=${Platform.OS}-scratch-phone`);
            Object.entries(remoteHeaders).forEach(([key, value]) => stream.setRequestHeader(key, value));
            stream.timeout = 5000;
            stream.onload = () => reject(new Error(`Wrong-pin SSE reached HTTP ${stream.status}`));
            stream.onprogress = () => { stream.abort(); reject(new Error('Wrong-pin SSE received HTTP data')); };
            stream.onerror = () => resolve();
            stream.ontimeout = () => reject(new Error('Wrong-pin SSE did not fail closed promptly'));
            stream.send();
          });
        });
        await configurePondTrust(trusted);
        await check('embedded plaintext is rejected', () => rejected(() => expoFetch(remote.replace('https:', 'http:') + '/api/v1/health', { headers })));
        for (const mode of ['renewed', 'expired', 'hostname'] as const) {
          await check(`embedded ${mode} certificate preserves the pin and enforces TLS`, async () => {
            assert((await expoFetch(origin + '/embedded-certificate/' + mode, { headers })).status === 200, 'Certificate fixture update failed');
            await configurePondTrust([{ url: origin, pin }]);
            await configurePondTrust(trusted);
            try {
              if (mode === 'renewed') {
                assert((await expoFetch(remote + '/api/v1/health', { headers })).status === 200, 'Renewed same-key certificate failed');
                await xhr('/api/v1/health', remote);
              } else {
                await rejected(() => expoFetch(remote + '/api/v1/health', { headers }));
                await rejected(() => xhr('/api/v1/health', remote));
              }
            } finally {
              assert((await expoFetch(origin + '/embedded-certificate/original', { headers })).status === 200, 'Certificate restoration failed');
              await configurePondTrust([{ url: origin, pin }]);
              await configurePondTrust(trusted);
            }
            assert((await expoFetch(remote + '/api/v1/health', { headers })).status === 200, 'Restored certificate cannot reconnect');
          });
        }
        await check('embedded redirects are refused before reaching their destination', async () => {
          await rejected(() => expoFetch(remote + '/api/v1/fixture-redirect', { headers }));
          await rejected(() => xhr('/api/v1/fixture-redirect', remote));
          assert((await expoFetch(origin + '/embedded-redirect-check', { headers })).status === 200, 'Redirect destination was reached');
        });
        await check('embedded identity survives native shutdown and reconnects', async () => {
          const before = JSON.parse(await NativeModules.PondTls.remoteStatus());
          await NativeModules.PondTls.disableRemote();
          await NativeModules.PondTls.activateRemote('headscale-app-fixture', control);
          for (let attempt = 0; attempt < 60; attempt++) {
            const after = JSON.parse(await NativeModules.PondTls.remoteStatus());
            if (after.state === 'Running') {
              assert(before.machineKey === after.machineKey && before.nodeKey === after.nodeKey, 'Restart replaced the network identity');
              assert((await expoFetch(remote + '/api/v1/health', { headers })).status === 200, 'Reconnected embedded HTTPS failed');
              return;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 500));
          }
          throw new Error('Embedded node did not reconnect');
        });
        await check('coordinator and relay outage fails closed and reconnects REST/SSE', async () => {
          const before = JSON.parse(await NativeModules.PondTls.remoteStatus());
          assert((await expoFetch(origin + '/embedded-outage/start', { headers })).status === 200, 'Fixture outage did not start');
          try {
            await configurePondTrust([{ url: origin, pin }]);
            await configurePondTrust(trusted);
            await rejected(() => expoFetch(remote + '/api/v1/health', { headers, signal: AbortSignal.timeout(5000) }));
            await rejected(() => xhr('/api/v1/health', remote));
          } finally {
            assert((await expoFetch(origin + '/embedded-outage/stop', { headers })).status === 200, 'Fixture gateway restoration failed');
          }
          await waitForRemote(remote);
          const current = JSON.parse(await NativeModules.PondTls.remoteStatus());
          assert(current.machineKey === before.machineKey && current.nodeKey === before.nodeKey, 'Outage replaced the native identity');
          await remoteStream(remote, remoteSession!);
        });
        await check('restored infrastructure preserves mobile identity and authenticated REST/SSE', async () => {
          const before = JSON.parse(await NativeModules.PondTls.remoteStatus());
          assert((await expoFetch(origin + '/embedded-backup-restore', { method: 'POST', headers })).status === 200, 'Infrastructure restore failed');
          await waitForRemote(remote);
          const after = JSON.parse(await NativeModules.PondTls.remoteStatus());
          assert(before.machineKey === after.machineKey && before.nodeKey === after.nodeKey, 'Restoration replaced the phone identity');
          const response = await expoFetch(remote + '/api/v1/devices', { headers: { ...headers, Authorization: `Bearer ${remoteSession}` } });
          assert(response.status === 200, 'Restored infrastructure lost authenticated REST');
          await remoteStream(remote, remoteSession!);
        });
        await check('replacement network identity requires and consumes local Pond approval', async () => {
          const before = JSON.parse(await NativeModules.PondTls.remoteStatus());
          client.setBaseUrl(pond.url);
          await client.handshakeRevoke();
          assert((await expoFetch(origin + '/embedded-revocation-ready', { headers })).status === 200, 'Network revocation was not reconciled');
          const fresh = await (await expoFetch(origin + '/pond-config', { headers })).json() as { code: string };
          const repaired = await client.pair({ clientId: `${Platform.OS}-scratch-phone`, pairingCode: fresh.code, deviceName: 'Local recovery verification' });
          assert(repaired.accepted && repaired.session_token, 'Fresh local pairing failed');
          api.setToken(repaired.session_token);
          let approval: Promise<void> | undefined;
          await enableRemoteAccess('replacement-app-fixture', pond.url, () => {}, async (endpoint, coordinator, current) => {
            current(); assert(endpoint === remote && coordinator === control, 'Recovery changed the approved endpoint');
            await NativeModules.PondTls.activateRemote('replacement-app-fixture', control);
            current();
          }, { onReview: (id) => {
            approval = expoFetch(origin + '/embedded-approve-recovery/' + id, { headers }).then((response) => {
              assert(response.status === 200, 'Local Pond approval failed');
            });
          } });
          assert(approval, 'Recovery skipped local approval');
          await approval;
          const after = JSON.parse(await NativeModules.PondTls.remoteStatus());
          assert(after.machineKey !== before.machineKey && after.state === 'Running', 'Approved replacement did not become active');
          assert((await expoFetch(remote + '/api/v1/health', { headers })).status === 200, 'Approved replacement cannot connect');
          await FixtureSecureStore.setItemAsync('fixture.remote', JSON.stringify({ remote, control, pin: pond.pin, token: repaired.session_token, machineKey: after.machineKey, nodeKey: after.nodeKey }));
        });
        await NativeModules.PondTls.disableRemote();
        await configurePondTrust([{ url: origin, pin }]);
      }
    });
  }
  await check('failed embedded activation stops the native node', async () => {
    // Nine targets exceed the Go proxy's limit after node startup. The coordinator
    // is loopback-only and deliberately untrusted; no public service is contacted.
    const entries = Array.from({ length: 9 }, (_, i) => ({ url: `https://100.64.0.${i + 1}:4443`, pin }));
    await configurePondTrust(entries);
    await rejected(() => NativeModules.PondTls.beginRemote('native-cleanup-fixture', origin));
    const status = JSON.parse(await NativeModules.PondTls.remoteStatus()) as { state: string };
    assert(status.state === 'Stopped', 'Failed activation left the native node running');
    await NativeModules.PondTls.cancelRemote();
  });
  await check('disabled embedded networking rejects remote fetch and XHR', async () => {
    const remote = 'https://100.64.0.10:4443';
    await configurePondTrust([{ url: remote, pin }]);
    await NativeModules.PondTls.disableRemote();
    await rejected(() => expoFetch(remote + '/disabled-fetch', { headers }));
    await rejected(() => xhr('/disabled-xhr', remote));
  });
  await configurePondTrust([{ url: origin, pin }]);
  await expoFetch(origin + '/report', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(results) });
  return results;
}

function TestApp() {
  useKeepAwake();
  const [output, setOutput] = useState('Running native transport integration tests');
  useEffect(() => { void run().then((value) => setOutput(JSON.stringify(value, null, 2))).catch((error) => setOutput(String(error))); }, []);
  return <ScrollView contentContainerStyle={{ padding: 24 }}><Text selectable>{output}</Text></ScrollView>;
}
registerRootComponent(TestApp);
