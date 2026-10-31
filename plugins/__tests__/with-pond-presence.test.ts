import { applyPondPresenceManifest } from '../with-pond-presence';

type Manifest = Parameters<typeof applyPondPresenceManifest>[0];

const SERVICE = 'io.jarida.pondpresence.PondPresenceService';

function manifest(): Manifest {
  return {
    'uses-permission': [{ $: { 'android:name': 'android.permission.FOREGROUND_SERVICE' } }],
    application: [{ $: {}, service: [{ $: { 'android:name': 'io.jarida.pondtls.PondNetworkService' } }] }],
  };
}

const permissions = (m: Manifest) => m['uses-permission'].map((p: { $: Record<string, string> }) => p.$['android:name']);

describe('applyPondPresenceManifest', () => {
  it('declares the service with the remoteMessaging type, unexported', () => {
    const result = applyPondPresenceManifest(manifest());
    const service = result.application[0].service.find((s: { $: Record<string, string> }) => s.$['android:name'] === SERVICE);
    expect(service.$).toEqual({
      'android:name': SERVICE,
      'android:exported': 'false',
      'android:foregroundServiceType': 'remoteMessaging',
    });
  });

  it('adds the permissions Android 14 checks for that type, once each', () => {
    const result = permissions(applyPondPresenceManifest(manifest()));
    expect(result).toEqual(expect.arrayContaining([
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING',
      'android.permission.POST_NOTIFICATIONS',
    ]));
    expect(new Set(result).size).toBe(result.length);
  });

  it('leaves other services alone and is a no-op the second time', () => {
    const once = applyPondPresenceManifest(manifest());
    const twice = applyPondPresenceManifest(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
    expect(once.application[0].service).toHaveLength(2);
  });
});
