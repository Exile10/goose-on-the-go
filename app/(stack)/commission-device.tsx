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
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { InkButton } from '@jarida/ink/native';
import { useRouter } from 'expo-router';

import { GIcon } from '@/components/ui/g-icon';
import { useDevices } from '@/view-models/use-devices';
import { Grey, JaridaPurple, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

/**
 * Accepts every form the controller does: a QR payload, an 11- or 21-digit
 * manual code, or a bare 8-digit passcode. Only obviously-empty input is
 * refused here — the controller is the authority on what decodes.
 */
function looksLikeSetupCode(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.startsWith('MT:')) return trimmed.length > 3;
  return /^\d{8}$|^\d{11}$|^\d{21}$/.test(trimmed.replace(/[\s-]/g, ''));
}

export default function CommissionDeviceScreen() {
  const router = useRouter();
  const { data, error, actions } = useDevices();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const commissioning = data.matter?.state === 'connecting';

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
    <View style={styles.container}>
      <GIcon name="device" size={28} color={JaridaPurple[500]} />
      <Text style={styles.title}>Add a Matter device</Text>
      <Text style={styles.desc}>
        Enter the setup code printed on the device or its packaging. A device only accepts
        pairing for about 15 minutes after it starts up, so power-cycle it first if it has
        been sitting.
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
        disabled={!looksLikeSetupCode(code) || commissioning}
        onPress={submit}
      >
        Add Device
      </InkButton>

      <Text style={styles.footnote}>
        A device straight out of the box has no Wi-Fi yet and can only be reached over
        Bluetooth. If it is not found, turn on Bluetooth pairing in your Pond&apos;s Matter
        settings and try again.
      </Text>
    </View>
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
