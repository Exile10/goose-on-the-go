/**
 * CommissionDeviceScreen — add a Matter device by its setup code.
 *
 * The code is a credential: it is redacted on both sides of the Pond's own
 * protocol, so it is never logged here and never echoed back in an error.
 *
 * Commissioning is slow — the server allows itself 180 seconds for the radio
 * work — so the screen commits to waiting rather than appearing to hang.
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { InkButton } from '@jarida/ink/native';
import { useFocusEffect, useRouter } from 'expo-router';

import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { GIcon } from '@/components/ui/g-icon';
import i18n from '@/services/i18n';
import { looksLikeTypedSetupCode } from '@/models/pairing';
import { takeSetupCode } from '@/services/pairing-handoff';
import { useDevices } from '@/view-models/use-devices';
import { Grey, JaridaPurple, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

export default function CommissionDeviceScreen() {
  const router = useRouter();
  const { data, error, actions } = useDevices();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
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
    const id = await actions.commission(code.trim(), name.trim() || undefined);
    setBusy(false);
    if (id) router.back();
  }, [actions, code, name, router]);

  if (busy) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={JaridaPurple[500]} />
        <Text style={styles.title}>Adding the device</Text>
        <Text style={styles.desc}>
          This can take a couple of minutes. Keep the device powered and nearby.
        </Text>
      </View>
    );
  }

  return (
    <GKeyboardView style={styles.container}>
      <GIcon name="device" size={28} color={JaridaPurple[500]} />
      <Text style={styles.title}>Add a Matter device</Text>
      <Text style={styles.desc}>
        Scan or enter the setup code printed on the device or its packaging. A device only
        accepts pairing for about 15 minutes after it starts up, so power-cycle it first if
        it has been sitting.
      </Text>

      {commissioning ? (
        <Text style={styles.notice}>
          Your Pond is still starting its Matter controller. Adding a device will not work
          until it has finished.
        </Text>
      ) : null}

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Setup code</Text>
        <TextInput
          style={styles.textInput}
          value={code}
          onChangeText={setCode}
          placeholder="12345678"
          placeholderTextColor={Grey[400]}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {/* A Matter QR payload is around ninety characters of base-38, which is
            not a thing to read off a box and type. Scanning is the ordinary
            route; the field stays because the manual code beside the QR exists
            for exactly the times the camera cannot be used. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(stack)/connect-desktop?mode=matter')}
          hitSlop={8}
          style={styles.scanLink}
        >
          <GIcon name="camera" size={16} color={JaridaPurple[500]} />
          <Text style={styles.scanLinkText}>{i18n.t('commission.scan')}</Text>
        </Pressable>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Name (optional)</Text>
        <TextInput
          style={styles.textInput}
          value={name}
          onChangeText={setName}
          placeholder="Kitchen light"
          placeholderTextColor={Grey[400]}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <InkButton
        variant="primary"
        disabled={!looksLikeTypedSetupCode(code) || commissioning}
        onPress={submit}
      >
        Add Device
      </InkButton>

      <Text style={styles.footnote}>
        A device straight out of the box has no Wi-Fi yet and can only be reached over
        Bluetooth. If it is not found, turn on Bluetooth pairing in your Pond&apos;s Matter
        settings and try again.
      </Text>
    </GKeyboardView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Grey[50], padding: Spacing.xl, gap: Spacing.md },
  centred: {
    flex: 1,
    backgroundColor: Grey[50],
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  title: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Grey[900],
    textAlign: 'center',
  },
  desc: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Grey[500],
    lineHeight: FontSize.base * 1.5,
  },
  notice: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Semantic.warning,
  },
  error: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Semantic.danger,
    lineHeight: FontSize.sm * 1.5,
  },
  footnote: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
    lineHeight: FontSize.sm * 1.5,
  },
  inputGroup: { gap: Spacing.xs },
  scanLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    paddingTop: Spacing.xs,
  },
  scanLinkText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: JaridaPurple[500],
  },
  inputLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Grey[700],
  },
  textInput: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Grey[900],
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Grey[200],
    borderRadius: Radii.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
});
