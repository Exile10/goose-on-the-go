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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
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

/**
 * How long the same code must stay readable before it is accepted.
 *
 * The scanner used to commit on the first frame that decoded, so a QR merely
 * passing through the lens paired the phone before the user had finished
 * aiming. QR carries its own error correction, so that read is not wrong — it is
 * just not yet a decision the user has made.
 *
 * Holding for a moment makes it one, and gives the framing something to settle
 * against. Long enough to be deliberate, short enough that a steady hand is not
 * kept waiting.
 */
const HOLD_STEADY_MS = 700;

/**
 * A code not seen for this long counts as gone, and the hold starts over.
 *
 * `onBarcodeScanned` simply stops firing when the code leaves the frame — there
 * is no "lost" event — so the only way to notice is the gap between frames.
 */
const LOST_AFTER_MS = 350;

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
  /** True while a valid code is being held in frame, before it is accepted. */
  const [holding, setHolding] = useState(false);

  // Which code is being held, and since when. A ref rather than state: it
  // changes on every camera frame and none of it belongs in a render.
  const held = useRef<{ data: string; since: number } | null>(null);
  const lostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [progress] = useState(() => new Animated.Value(0));

  const abandonHold = useCallback(() => {
    held.current = null;
    setHolding(false);
    progress.stopAnimation();
    progress.setValue(0);
  }, [progress]);

  useEffect(() => () => {
    if (lostTimer.current) clearTimeout(lostTimer.current);
  }, []);

  const handleScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (!scanning) return;

      let payload;
      try {
        payload = parsePairingPayload(data);
      } catch (e) {
        // Judged immediately rather than after the hold: a QR that is not a
        // pairing code will never become one by being held longer, and the
        // Matter case below is worth saying at once.
        setScanning(false);
        abandonHold();
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
        return;
      }

      const now = Date.now();
      const current = held.current;

      // Restart the hold whenever the code in frame is a different one.
      if (!current || current.data !== data) {
        held.current = { data, since: now };
        setHolding(true);
        progress.setValue(0);
        Animated.timing(progress, {
          toValue: 1,
          duration: HOLD_STEADY_MS,
          easing: Easing.linear,
          useNativeDriver: false,
        }).start();
      }

      // Each frame pushes the deadline out; silence past it means the code left
      // the frame, so the hold is abandoned rather than quietly completing.
      if (lostTimer.current) clearTimeout(lostTimer.current);
      lostTimer.current = setTimeout(abandonHold, LOST_AFTER_MS);

      const heldSince = held.current?.since ?? now;
      if (now - heldSince < HOLD_STEADY_MS) return;

      if (lostTimer.current) clearTimeout(lostTimer.current);
      setScanning(false);
      abandonHold();
      offerPairingPayload(payload);
      router.back();
    },
    [router, scanning, abandonHold, progress],
  );

  const retry = useCallback(() => {
    setError(null);
    abandonHold();
    setScanning(true);
  }, [abandonHold]);

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
          <View style={[styles.corner, styles.cornerTL, holding && styles.cornerHolding]} />
          <View style={[styles.corner, styles.cornerTR, holding && styles.cornerHolding]} />
          <View style={[styles.corner, styles.cornerBL, holding && styles.cornerHolding]} />
          <View style={[styles.corner, styles.cornerBR, holding && styles.cornerHolding]} />
        </View>

        {/* The hold made visible, so waiting reads as progress, not as a stall. */}
        {holding && !error ? (
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
        ) : null}

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
            {holding
              ? 'Hold steady\u2026'
              : "Point the camera at the QR code on your Pond's dashboard"}
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
  progressTrack: {
    width: FRAME_SIZE,
    height: 3,
    marginTop: Spacing.md,
    borderRadius: Radii.sm,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Semantic.success,
  },
  corner: {
    position: 'absolute',
    width: CORNER_SIZE,
    height: CORNER_SIZE,
    borderColor: JaridaPurple[400],
  },
  // Brightens the moment a valid code is held, so the frame itself confirms the
  // aim before any text does.
  cornerHolding: { borderColor: Semantic.success },
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
