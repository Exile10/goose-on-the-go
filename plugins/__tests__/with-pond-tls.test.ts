import { applyPondManifest } from '../with-pond-tls';

type Entry = { $: Record<string, string> };
type Manifest = { manifest: { application: { $: Record<string, string>; service?: Entry[] }[]; 'uses-permission'?: Entry[] } };

const fresh = (): Manifest => ({ manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } });
const service = (manifest: Manifest) =>
  manifest.manifest.application[0].service?.filter((entry) => entry.$['android:name'] === 'io.jarida.pondtls.PondNetworkService') ?? [];
const permissions = (manifest: Manifest) => (manifest.manifest['uses-permission'] ?? []).map((entry) => entry.$['android:name']);

describe('applyPondManifest', () => {
  it('declares the remote-access service as connectedDevice, never a time-limited type', () => {
    const [declared] = service(applyPondManifest(fresh()));
    expect(declared.$['android:foregroundServiceType']).toBe('connectedDevice');
    expect(declared.$['android:exported']).toBe('false');
  });

  it('declares the permission that type requires', () => {
    expect(permissions(applyPondManifest(fresh()))).toContain('android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE');
  });

  it('corrects a service an earlier prebuild declared as dataSync', () => {
    const manifest = fresh();
    manifest.manifest.application[0].service = [{ $: { 'android:name': 'io.jarida.pondtls.PondNetworkService', 'android:foregroundServiceType': 'dataSync' } }];
    const declared = service(applyPondManifest(manifest));
    expect(declared).toHaveLength(1);
    expect(declared[0].$['android:foregroundServiceType']).toBe('connectedDevice');
  });

  it('is a no-op on a manifest it has already rewritten', () => {
    const once = applyPondManifest(fresh());
    const twice = applyPondManifest(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it('keeps cleartext off and the pinned network config on', () => {
    const app = applyPondManifest(fresh()).manifest.application[0].$;
    expect(app['android:usesCleartextTraffic']).toBe('false');
    expect(app['android:networkSecurityConfig']).toBe('@xml/pond_network_security');
  });
});
