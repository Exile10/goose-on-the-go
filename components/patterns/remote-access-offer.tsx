/**
 * Offers remote access once, on Home, to a Pond that is paired without it.
 *
 * This used to be a screen the pairing wizard pushed you onto when it finished,
 * which made setting up a Pond a two-part question and left anyone who reached
 * for the Home tab with a finished wizard still in the stack. Pairing now ends
 * at Home and the offer lives here, where it can be declined.
 *
 * Dismissal is remembered against the paired profile rather than forever. A
 * household that says "not now" is not asked again for that pairing, and a
 * phone that pairs afresh is offered it again, which is the point at which it
 * is worth asking.
 */

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { InkButton, InkCard, InkText, InkTitle } from '@jarida/ink/native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Storage } from '@/services/storage';
import { useServer } from '@/providers/server-provider';
import { Spacing } from '@/constants/spacing';

export function RemoteAccessOffer() {
  const { hydrated, profileId, remoteEnabled, connectionState } = useServer();
  const { t } = useTranslation();
  const router = useRouter();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    void Storage.get('remoteOfferDismissed')
      .then((value) => { if (live) { setDismissed(value); setLoaded(true); } })
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(profileId);
    void Storage.set('remoteOfferDismissed', profileId).catch(() => undefined);
  }, [profileId]);

  // Only for a Pond this phone is actually paired with and reaching. Asking
  // while the connection is unknown would put a question on top of a problem.
  const paired = connectionState === 'local' || connectionState === 'remote';
  if (!hydrated || !loaded || !paired || remoteEnabled || !profileId) return null;
  if (dismissed === profileId) return null;

  return (
    <InkCard style={styles.card}>
      <InkTitle level={3}>{t('remote.title')}</InkTitle>
      <InkText>{t('remote.description')}</InkText>
      <View style={styles.actions}>
        <InkButton variant="primary" block onPress={() => router.push('/(stack)/remote-access')}>
          {t('remote.continue')}
        </InkButton>
        <InkButton variant="quiet" block onPress={dismiss}>
          {t('remote.notNow')}
        </InkButton>
      </View>
    </InkCard>
  );
}

// An InkCard already has its own face and plate; its style carries layout only.
const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  actions: { marginTop: Spacing.xs, gap: Spacing.sm },
});
