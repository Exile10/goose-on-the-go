/**
 * A pin learned from the network is confirmed by reading its start against the
 * Pond's own dashboard. What is read has to be long enough that no other key
 * shares it, and grouped so a person can compare it.
 */
import { pinPreview, validPin } from '@/models/connection';

const PIN = 'sha256/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/abcde=';

describe('pinPreview', () => {
  it('uses a real pin', () => {
    expect(validPin(PIN)).toBe(true);
  });

  it('shows the first twelve characters in groups of four', () => {
    expect(pinPreview(PIN)).toBe('sha256/AbCd EfGh IjKl');
  });

  it('is a prefix of the pin once the grouping is removed', () => {
    expect(PIN.startsWith(pinPreview(PIN).replace(/ /g, ''))).toBe(true);
  });
});
