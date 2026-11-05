/**
 * CommissionDeviceScreen — add a Matter device by its setup code.
 *
 * The code is a credential: it is redacted on both sides of the Pond's own
 * protocol, so it is never logged here and never echoed back in an error.
 *
 * Commissioning is slow — the server allows itself 180 seconds for the radio
 * work — so the screen commits to waiting rather than appearing to hang.
 *
 * Opened from setup's rooms step for a device the Pond found, it carries the room chosen there
 * (`room`, an id) and the name the device gave (`name`), so the device lands where it was put.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  InkButton,
  InkFormField,
  InkInput,
  InkNotice,
  InkSpinner,
  InkText,
  InkTitle,
  useInkTheme,
} from '@jarida/ink/native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { GIcon } from '@/components/ui/g-icon';
import { GKeyboardScrollView } from '@/components/ui/g-keyboard-view';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { looksLikeTypedSetupCode } from '@/models/pairing';
import { takeSetupCode } from '@/services/pairing-handoff';
import { useDevices } from '@/view-models/use-devices';

export default function CommissionDeviceScreen() {
  const styles = useThemedStyles(makeStyles);
  const theme = useInkTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ room?: string; name?: string }>();
  const { data, error, actions } = useDevices();
  const [code, setCode] = useState('');
  const [name, setName] = useState(params.name ?? '');
  const [busy, setBusy] = useState(false);

  const commissioning = data.matter?.state === 'connecting';

  // Collect whatever the scanner left on the way back. On focus rather than on
  // mount, because this screen is still mounted underneath the scanner and
  // never remounts when it closes. `takeSetupCode` clears as it reads, so
  // returning here later cannot resurrect an old scan.
  useFocusEffect(
    useCallback(() => {
      const scanned = takeSetupCode();
      if (scanned) setCode(scanned);
    }, []),
  );

  const submit = useCallback(async () => {
    setBusy(true);
    const id = await actions.commission(code.trim(), name.trim() || undefined, params.room || undefined);
    setBusy(false);
    if (id) router.back();
  }, [actions, code, name, params.room, router]);

  if (busy) {
    return (
      <View style={styles.centred}>
        <InkSpinner label={t('commission.adding')} size={28} />
        <InkTitle level={2} style={styles.centredText}>{t('commission.adding')}</InkTitle>
        <InkText tone="secondary" style={styles.centredText}>{t('commission.addingDesc')}</InkText>
      </View>
    );
  }

  return (
    <GKeyboardScrollView containerStyle={styles.container} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <GIcon name="device" size={28} color={theme.color.accentLine} />
      <InkTitle level={2}>{t('commission.title')}</InkTitle>
      <InkText tone="secondary">{t('commission.desc')}</InkText>

      {commissioning ? <InkNotice tone="warning">{t('commission.controllerStarting')}</InkNotice> : null}

      <InkFormField label={t('commission.setupCode')}>
        <InkInput
          label={t('commission.setupCode')}
          value={code}
          onChange={setCode}
          placeholder={t('commission.codePlaceholder')}
          inputProps={{ autoCapitalize: 'characters', autoCorrect: false, returnKeyType: 'next' }}
        />
        {/* A Matter QR payload is around ninety characters of base-38, which is
            not a thing to read off a box and type. Scanning is the ordinary
            route; the field stays because the manual code beside the QR exists
            for exactly the times the camera cannot be used. */}
        <InkButton size="sm" icon="camera" onPress={() => router.push('/(stack)/connect-desktop?mode=matter')}>
          {t('commission.scan')}
        </InkButton>
      </InkFormField>

      <InkFormField label={t('commission.nameOptional')}>
        <InkInput
          label={t('commission.nameOptional')}
          value={name}
          onChange={setName}
          placeholder={t('commission.namePlaceholder')}
        />
      </InkFormField>

      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}

      <InkButton variant="primary" block disabled={!looksLikeTypedSetupCode(code) || commissioning} onPress={submit}>
        {t('commission.addDevice')}
      </InkButton>
      <InkText size="sm" tone="secondary">{t('commission.bluetoothFootnote')}</InkText>
    </GKeyboardScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing['3xl'] },
    centred: {
      flex: 1,
      backgroundColor: c.background,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.md,
    },
    centredText: { textAlign: 'center' },
  });
