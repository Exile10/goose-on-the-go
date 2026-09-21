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
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Storage } from '@/services/storage';
import { useServer } from '@/providers/server-provider';
import { Grey, JaridaPurple, Brand } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

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
    <View style={styles.card}>
      <Text style={styles.title}>{t('remote.title')}</Text>
      <Text style={styles.body}>{t('remote.description')}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          style={styles.primary}
          onPress={() => router.push('/(stack)/remote-access')}
        >
          <Text style={styles.primaryText}>{t('remote.continue')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={dismiss}>
          <Text style={styles.secondaryText}>{t('remote.notNow')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Grey[200],
    padding: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  title: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Grey[900],
  },
  body: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[600],
    lineHeight: FontSize.sm * 1.5,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.xs },
  primary: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radii.md,
    backgroundColor: JaridaPurple[500],
  },
  primaryText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Brand.white,
  },
  secondary: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.sm },
  secondaryText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Grey[600],
  },
});
