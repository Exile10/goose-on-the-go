import { ApiError } from '@/services/api-client';
import i18n from '@/services/i18n';
import { refusalText } from '@/view-models/use-ngrok-tunnel';

const refused = (status: number, code: string) =>
  new ApiError(`PUT /api/v1/remote-access/route → ${status}`, status, null, null, { error: 'English from the Pond', code });

describe('refusalText', () => {
  it('says what to do for each refusal the Pond sends', () => {
    expect(refusalText(refused(400, 'authtoken_refused'))).toBe(i18n.t('ngrok.error.tokenRefused'));
    expect(refusalText(refused(403, 'at_home_only'))).toBe(i18n.t('ngrok.error.atHomeOnly'));
    expect(refusalText(refused(409, 'needs_reserved_address'))).toBe(i18n.t('ngrok.error.needsReserved'));
    expect(refusalText(refused(409, 'no_authtoken'))).toBe(i18n.t('ngrok.error.noToken'));
    expect(refusalText(refused(400, 'invalid_config'))).toBe(i18n.t('ngrok.error.badAddress'));
    expect(refusalText(refused(503, 'built_in_unavailable'))).toBe(i18n.t('ngrok.error.builtInUnavailable'));
  });

  it("never shows the Pond's English sentence", () => {
    expect(refusalText(refused(500, 'config_unwritable'))).not.toContain('English from the Pond');
  });

  it('leaves a lost connection to the banner', () => {
    expect(refusalText(new TypeError('Network request failed'))).toBeNull();
  });
});
