/**
 * ConnectDesktopScreen — scan the pairing QR shown on the Pond's dashboard.
 *
 * This screen only decodes. It performs no networking and never holds a token:
 * the decoded payload is handed to the pairing wizard, which runs the same
 * handshake as manual code entry, so there is one crypto path and one token
 * store rather than two.
 *
 * The QR encodes a live pairing code. It is never logged, and the scanner's own
 * error copy never echoes it back.
 */

import React, { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';

import { GIcon } from '@/components/ui/g-icon';
import { GButton } from '@/components/ui/g-button';
import {
  InvalidPairingCodeError,
  looksLikeMatterSetupCode,
  parsePairingPayload,
} from '@/models/pairing';
import { offerPairingPayload } from '@/services/pairing-handoff';
import { Brand, Grey, JaridaPurple, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';

const FRAME_SIZE = 240;
const CORNER_SIZE = 28;

export default function ConnectDesktopScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);

  /**
   * The camera keeps firing while a frame is in view, so scanning is disabled
   * the moment a code decodes. Without that, one QR in front of the lens hands
   * the wizard the same payload dozens of times.
   */
  const [scanning, setScanning] = useState(true);

  const handleScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (!scanning) return;
      setScanning(false);
      try {
        offerPairingPayload(parsePairingPayload(data));
        router.back();
      } catch (e) {
        if (!(e instanceof InvalidPairingCodeError)) {
          setError('Could not read that code. Try again.');
          return;
        }
        // Name the mistake rather than just rejecting it: a Matter device's
        // code is valid, only in a different part of the app, and sending the
        // user back to hunt for "the right QR" is the unhelpful outcome here.
        setError(
          looksLikeMatterSetupCode(data)
            ? 'That is a Matter device setup code, not a Pond pairing code. Use Devices, then Add device, to commission it. The pairing code is the one on your Pond dashboard.'
            : 'That is not a Goose In A Pond pairing code. Open Pairing on your Pond and scan the code it shows.',
        );
      }
    },
    [router, scanning],
  );

  const retry = useCallback(() => {
    setError(null);
    setScanning(true);
  }, []);

  // Permission not yet determined — the hook answers on the next render.
  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    // Once `canAskAgain` is false the OS will not show the prompt again, so the
    // only route back is the Settings app. Calling requestPermission there does
    // nothing at all, which leaves a user who denied once with no way forward.
    const canPrompt = permission.canAskAgain;
    return (
      <View style={styles.permissionContainer}>
        <GIcon name="camera" size={32} color={JaridaPurple[500]} />
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionDesc}>
          Scanning the pairing code needs the camera. You can also enter the six digits by
          hand instead.
        </Text>
        <GButton
          variant="primary"
          size="lg"
          onPress={canPrompt ? requestPermission : () => void Linking.openSettings()}
        >
          {canPrompt ? 'Enable Camera' : 'Open Settings'}
        </GButton>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.cancel}>Enter the code instead</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanning ? handleScanned : undefined}
      />
      <View style={styles.overlay}>
        <View style={styles.frame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>

        {error ? (
          <View style={styles.statusCard}>
            <GIcon name="warn" size={28} color={Semantic.danger} />
            <Text style={styles.statusTitle}>Could not use that code</Text>
            <Text style={styles.statusDesc}>{error}</Text>
            <GButton variant="primary" size="sm" onPress={retry}>
              Scan again
            </GButton>
          </View>
        ) : (
          <Text style={styles.hint}>
            Point the camera at the QR code on your Pond&apos;s dashboard
          </Text>
        )}

        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.cancel}>Enter the code instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Brand.charcoal },

  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing['2xl'],
    paddingHorizontal: Spacing.xl,
  },

  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: JaridaPurple[400],
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: Radii.md },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: Radii.md },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: Radii.md },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: Radii.md },

  hint: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Brand.white,
    textAlign: 'center',
  },
  cancel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Brand.white,
    textDecorationLine: 'underline',
  },

  statusCard: {
    width: '100%',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    paddingVertical: Spacing['2xl'],
    paddingHorizontal: Spacing.xl,
  },
  statusTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Brand.charcoal,
  },
  statusDesc: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Grey[600],
    textAlign: 'center',
  },
  cancelText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Grey[500],
  },

  /* Permission request */
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
    paddingHorizontal: Spacing['2xl'],
    backgroundColor: Grey[50],
  },
  permissionTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Brand.charcoal,
    textAlign: 'center',
  },
  permissionDesc: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Grey[500],
    textAlign: 'center',
    lineHeight: FontSize.base * 1.5,
  },
});
