// The service follows the household's phrase: told once per change, with words that name it.

import i18n from '@/services/i18n';

const mockConfigure = jest.fn();
jest.mock('@/services/phone-wake', () => ({
  ...jest.requireActual('@/services/phone-wake'),
  configurePhoneWake: (...args: unknown[]) => mockConfigure(...args),
}));
jest.mock('@/services/api-client', () => ({ api: {} }));

import { followWakePhrase, wakeNotificationWords } from '@/services/phone-wake-pond';

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

it('tells the service a new phrase once, however it is written, and again when it changes', () => {
  followWakePhrase('Hey Jarvis');
  followWakePhrase('hey jarvis!');
  expect(mockConfigure).toHaveBeenCalledTimes(1);
  expect(mockConfigure).toHaveBeenLastCalledWith('Hey Jarvis', wakeNotificationWords('Hey Jarvis'));
  followWakePhrase('Hey Goose');
  expect(mockConfigure).toHaveBeenCalledTimes(2);
  followWakePhrase('   ');
  expect(mockConfigure).toHaveBeenCalledTimes(2);
});

it('names the phrase in the notification', () => {
  const words = wakeNotificationWords('Hey Jarvis');
  expect(words.title).toBe(i18n.t('settings.phoneWake.notification.title', { phrase: 'Hey Jarvis' }));
  expect(words.title).toContain('Hey Jarvis');
  expect(words.body).toContain('Hey Jarvis');
});
