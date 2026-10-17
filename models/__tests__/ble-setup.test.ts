import i18n from '@/services/i18n';
import type { ChannelStatus } from '@/services/setup-channel/session';
import {
  defaultPhoneName,
  handoverProfile,
  joinedAt,
  needsPassphrase,
  normaliseHostname,
  onlineAt,
  passphraseUsable,
  securityKey,
  wifiChoices,
  wifiErrorKey,
} from '../ble-setup';

const status = (network: ChannelStatus['network'], httpsPort = 4443): ChannelStatus => ({
  claimed: true, onboarded: false, network, httpsPort, hostname: 'Nano.local.',
});

describe('setting up over the setup channel', () => {
  it('skips Wi-Fi only for a Pond with an address of its own', () => {
    expect(onlineAt(status({ state: 'connected', ssid: null, ipv4: '192.168.1.40' }))).toEqual({ address: '192.168.1.40', httpsPort: 4443, hostname: 'Nano.local.' });
    expect(onlineAt(status({ state: 'connecting', ssid: 'Home', ipv4: null }))).toBeNull();
    expect(onlineAt(status({ state: 'connected', ssid: 'Home', ipv4: null }))).toBeNull();
    expect(onlineAt(status({ state: 'connected', ssid: null, ipv4: '192.168.1.40' }, 0))).toBeNull();
  });

  it('keeps the pairing at the numeric address and finds it again by its host name', () => {
    expect(normaliseHostname('Nano.local.')).toBe('nano');
    expect(handoverProfile({ address: '192.168.1.40', httpsPort: 4443, hostname: 'Nano.local.' })).toEqual({
      version: 2, host: 'nano', port: 4443, localUrls: ['https://192.168.1.40:4443'], remoteAccess: { mode: 'local' },
    });
    expect(handoverProfile({ address: '192.168.1.40', httpsPort: 4443, hostname: '' }).host).toBe('192.168.1.40');
    expect(joinedAt({ address: '10.0.0.5', httpsPort: 4443, hostname: '' }, status({ state: 'disconnected', ssid: null, ipv4: null })).hostname).toBe('Nano.local.');
  });

  it('lists each network once, known first, then strongest', () => {
    const list = wifiChoices([
      { ssid: 'Home', security: 'wpa2', signal: 40, known: false },
      { ssid: 'Cafe', security: 'open', signal: 90, known: false },
      { ssid: 'Home', security: 'wpa2', signal: 70, known: false },
      { ssid: 'Office', security: 'wpa3', signal: 10, known: true },
    ]);
    expect(list.map((n) => [n.ssid, n.signal])).toEqual([['Office', 10], ['Cafe', 90], ['Home', 70]]);
  });

  it('asks for a password only where one is needed and could work', () => {
    expect(needsPassphrase({ security: 'open', known: false })).toBe(false);
    expect(needsPassphrase({ security: 'wpa2', known: true })).toBe(false);
    expect(needsPassphrase({ security: 'wpa3', known: false })).toBe(true);
    expect(passphraseUsable('wpa2', 'short')).toBe(false);
    expect(passphraseUsable('wpa2', 'longenough')).toBe(true);
    expect(passphraseUsable('wpa2', 'x'.repeat(64))).toBe(false);
    expect(passphraseUsable('wep', '12345')).toBe(true);
  });

  it('has its own sentence for every wifi_join refusal', () => {
    const codes = ['wrong_password', 'not_found', 'no_address', 'timeout', 'not_permitted', 'unsupported', 'busy'];
    const keys = codes.map(wifiErrorKey);
    expect(new Set(keys).size).toBe(codes.length);
    expect(keys).not.toContain(wifiErrorKey('something_new'));
    for (const key of [...keys, wifiErrorKey(null), securityKey('enterprise'), securityKey('wpa3')]) {
      expect(i18n.exists(key)).toBe(true);
    }
  });

  it('names the phone after itself, else its model', () => {
    expect(defaultPhoneName('Wanjiru’s iPhone', 'iPhone 17')).toBe('Wanjiru’s iPhone');
    expect(defaultPhoneName(null, 'Galaxy A57')).toBe('Galaxy A57');
    expect(defaultPhoneName('  ', null)).toBe('');
  });
});
