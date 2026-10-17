/**
 * When an advertised pin has to be picked out of three against the Pond's own screen. The pick
 * exists for a household that has a screen; a Pond with none can only prove its pin through an
 * exchange that binds it, which a setup code and a spoken code both do.
 */
import { pickBeforeExchange } from '@/models/connection';

describe('pickBeforeExchange', () => {
  // The spoken path: how a second household member adds a phone to a claimed Pond with no screen.
  it('skips the pick for a spoken code, whether or not the Pond advertised setup=1', () => {
    expect(pickBeforeExchange({ pin: 'advertised', credential: 'pairing', codeSpoken: true })).toBe(false);
  });

  it('skips the pick before a setup exchange', () => {
    expect(pickBeforeExchange({ pin: 'advertised', credential: 'setup', codeSpoken: false })).toBe(false);
    expect(pickBeforeExchange({ pin: 'advertised', credential: 'setup', codeSpoken: true })).toBe(false);
  });

  // A code read off a dashboard or a terminal: that household has a screen, so nothing changes for it.
  it('keeps the pick for a six-digit code that was not spoken', () => {
    expect(pickBeforeExchange({ pin: 'advertised', credential: 'pairing', codeSpoken: false })).toBe(true);
  });

  it('never asks again for a pin that was already checked', () => {
    for (const credential of ['pairing', 'setup'] as const) {
      for (const codeSpoken of [true, false]) {
        expect(pickBeforeExchange({ pin: 'checked', credential, codeSpoken })).toBe(false);
      }
    }
  });
});
