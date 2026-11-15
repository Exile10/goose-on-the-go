import fs from 'fs';
import os from 'os';
import path from 'path';

import { applyPondWakeManifest, copyPondEarLibraries } from '../with-pond-wake';

type Manifest = Parameters<typeof applyPondWakeManifest>[0];

const SERVICE = 'io.jarida.pondwake.GooseWakeService';

function manifest(): Manifest {
  return {
    'uses-permission': [{ $: { 'android:name': 'android.permission.RECORD_AUDIO' } }],
    application: [{ $: {}, service: [{ $: { 'android:name': 'io.jarida.pondtls.PondNetworkService' } }] }],
  };
}

describe('applyPondWakeManifest', () => {
  it('declares the listening service as a microphone service only the app can start', () => {
    const services = applyPondWakeManifest(manifest()).application[0].service;
    expect(services.find((s: { $: Record<string, string> }) => s.$['android:name'] === SERVICE).$).toEqual({
      'android:name': SERVICE,
      'android:exported': 'false',
      'android:foregroundServiceType': 'microphone',
    });
  });

  it('asks for the microphone foreground service type, once, beside what was there', () => {
    const names = (m: Manifest) => m['uses-permission'].map((p: { $: Record<string, string> }) => p.$['android:name']);
    const once = applyPondWakeManifest(manifest());
    const twice = applyPondWakeManifest(applyPondWakeManifest(manifest()));
    expect(names(once)).toEqual(['android.permission.RECORD_AUDIO', 'android.permission.FOREGROUND_SERVICE_MICROPHONE']);
    expect(names(twice)).toEqual(names(once));
    expect(twice.application[0].service).toHaveLength(2);
  });
});

describe('copyPondEarLibraries', () => {
  let root: string;
  let main: string;
  const library = (abi: string) => path.join(root, 'native/pondear/jniLibs', abi, 'libpondear.so');
  const put = (abi: string) => {
    fs.mkdirSync(path.dirname(library(abi)), { recursive: true });
    fs.writeFileSync(library(abi), `elf for ${abi}`);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pondear-'));
    main = path.join(root, 'android/app/src/main');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('copies each packaged ABI, and the emulator one when it was built', () => {
    ['arm64-v8a', 'armeabi-v7a', 'x86_64'].forEach(put);
    copyPondEarLibraries(root, main);
    for (const abi of ['arm64-v8a', 'armeabi-v7a', 'x86_64']) {
      expect(fs.readFileSync(path.join(main, 'jniLibs', abi, 'libpondear.so'), 'utf8')).toBe(`elf for ${abi}`);
    }
  });

  it('leaves the emulator ABI out when it was not built', () => {
    ['arm64-v8a', 'armeabi-v7a'].forEach(put);
    copyPondEarLibraries(root, main);
    expect(fs.existsSync(path.join(main, 'jniLibs/x86_64'))).toBe(false);
  });

  it('builds the detector when a packaged ABI is missing', () => {
    put('arm64-v8a');
    const build = jest.fn(() => {
      put('armeabi-v7a');
      return true;
    });
    copyPondEarLibraries(root, main, build);
    expect(build).toHaveBeenCalledWith(root);
    expect(fs.existsSync(path.join(main, 'jniLibs/armeabi-v7a/libpondear.so'))).toBe(true);
  });

  it('packages what there is, naming the script, when this machine cannot build it', () => {
    put('arm64-v8a');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    copyPondEarLibraries(root, main, () => false);
    expect(fs.existsSync(path.join(main, 'jniLibs/arm64-v8a/libpondear.so'))).toBe(true);
    expect(fs.existsSync(path.join(main, 'jniLibs/armeabi-v7a'))).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('armeabi-v7a, so "Hey Goose" is not offered there; run scripts/build-embedded-ear.sh'));
    warn.mockRestore();
  });

  it('builds nothing when every packaged ABI is there', () => {
    ['arm64-v8a', 'armeabi-v7a'].forEach(put);
    const build = jest.fn(() => true);
    copyPondEarLibraries(root, main, build);
    expect(build).not.toHaveBeenCalled();
  });
});

describe('the notices', () => {
  it('are tracked beside the shim, naming what the library carries', () => {
    const notices = fs.readFileSync(path.join(__dirname, '..', '..', 'native/pondear/THIRD_PARTY_NOTICES.txt'), 'utf8');
    expect(notices).toContain('Silero Team');
    expect(notices).toContain('rust-jni-sys Developers');
    expect(notices).toContain('pond-ear');
  });
});
