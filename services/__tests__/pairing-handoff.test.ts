import {
  clearPairingStart,
  offerPairingStart,
  peekPairingStart,
  takePairingPayload,
} from '@/services/pairing-handoff';

afterEach(() => clearPairingStart());

describe('where the pairing wizard begins', () => {
  it('starts at its own search when nothing was handed over', () => {
    expect(peekPairingStart()).toBeNull();
  });

  it('carries the Pond the welcome screen picked, pin and all', () => {
    offerPairingStart({ kind: 'pond', url: 'https://192.168.1.14:4443', pin: 'sha256/abc' });
    expect(peekPairingStart()).toEqual({ kind: 'pond', url: 'https://192.168.1.14:4443', pin: 'sha256/abc' });
  });

  it('can be read twice, as a strict-mode initialiser does, until it is cleared', () => {
    offerPairingStart({ kind: 'address' });
    expect(peekPairingStart()).toEqual({ kind: 'address' });
    expect(peekPairingStart()).toEqual({ kind: 'address' });
    clearPairingStart();
    // A later visit to the wizard begins with its search again.
    expect(peekPairingStart()).toBeNull();
  });

  it('is not mistaken for a scanned pairing payload', () => {
    offerPairingStart({ kind: 'address' });
    expect(takePairingPayload()).toBeNull();
    expect(peekPairingStart()).toEqual({ kind: 'address' });
  });
});
