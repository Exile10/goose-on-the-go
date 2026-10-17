import {
  clearPairingStart,
  offerPairingStart,
  offerSetupCard,
  peekPairingStart,
  takePairingPayload,
  takeSetupCard,
  takeSetupCode,
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

describe('a scanned setup card', () => {
  const card = { code: '34970112339', id: '7f3a' };

  it('is handed to exactly one reader, so a code cannot be replayed on a later visit', () => {
    offerSetupCard(card);
    expect(takeSetupCard()).toEqual(card);
    expect(takeSetupCard()).toBeNull();
  });

  // Its own slot: a Matter scan must not be read as a Pond's card, or the other way round.
  it('is not mistaken for a pairing payload or a Matter setup code', () => {
    offerSetupCard(card);
    expect(takePairingPayload()).toBeNull();
    expect(takeSetupCode()).toBeNull();
    expect(takeSetupCard()).toEqual(card);
  });
});
