/**
 * PondPairingScreen — 4-step pairing wizard:
 *   0. Enter the GIAP server URL (LAN address from the dashboard)
 *   1. Enter the 6-digit pairing code shown on the GIAP host
 *   2. Name this device
 *   3. Run the two-phase handshake and confirm
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useRouter } from 'expo-router';
import { GIcon } from '@/components/ui/g-icon';
import { GButton } from '@/components/ui/g-button';
import { Grey, JaridaPurple, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useServer } from '@/providers/server-provider';

type Step = 0 | 1 | 2 | 3;
const STEP_LABELS = ['Server', 'Pairing Code', 'Name Device', 'Complete'];

function randomClientId(): string {
  // RFC4122-ish v4 (sufficient for a stable per-install identifier).
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Step indicator */
function StepIndicator({ current }: { current: Step }) {
  return (
    <View style={styles.stepRow}>
      {STEP_LABELS.map((label, i) => {
        const isActive = i === current;
        const isDone = i < current;
        return (
          <View key={label} style={styles.stepItem}>
            <View
              style={[
                styles.stepDot,
                isDone && styles.stepDotDone,
                isActive && styles.stepDotActive,
              ]}
            >
              {isDone ? (
                <GIcon name="check" size={14} color={Brand.white} />
              ) : (
                <Text style={[styles.stepNumber, isActive && styles.stepNumberActive]}>
                  {i + 1}
                </Text>
              )}
            </View>
            <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Step 0: Server URL */
function ServerStep({
  initial,
  onNext,
}: {
  initial: string;
  onNext: (url: string) => void;
}) {
  const [url, setUrl] = useState(initial);
  return (
    <View style={styles.stepContent}>
      <GIcon name="search" size={28} color={JaridaPurple[500]} />
      <Text style={styles.stepTitle}>Connect to GIAP</Text>
      <Text style={styles.stepDesc}>
        Enter the URL of your Goose In A Pond server — shown in the dashboard
        banner on the host machine.
      </Text>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Server URL</Text>
        <TextInput
          style={styles.textInput}
          value={url}
          onChangeText={setUrl}
          placeholder="http://pond.local:4000"
          placeholderTextColor={Grey[400]}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <GButton variant="primary" size="lg" onPress={() => onNext(url)}>
        Continue
      </GButton>
    </View>
  );
}

/** Step 1: Pairing code */
function PairingCodeStep({ onNext }: { onNext: (code: string) => void }) {
  const [code, setCode] = useState('');
  const valid = /^\d{6}$/.test(code);
  return (
    <View style={styles.stepContent}>
      <GIcon name="wifi" size={28} color={JaridaPurple[500]} />
      <Text style={styles.stepTitle}>Enter Pairing Code</Text>
      <Text style={styles.stepDesc}>
        The 6-digit code is shown on the GIAP host's dashboard or terminal
        when the server starts. It expires after 10 minutes.
      </Text>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Code</Text>
        <TextInput
          style={styles.textInput}
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          placeholderTextColor={Grey[400]}
          keyboardType="number-pad"
          autoFocus
        />
      </View>
      <GButton
        variant="primary"
        size="lg"
        disabled={!valid}
        onPress={() => onNext(code)}
      >
        Continue
      </GButton>
    </View>
  );
}

/** Step 2: Name Device */
function NameStep({ onNext }: { onNext: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <View style={styles.stepContent}>
      <GIcon name="edit" size={28} color={JaridaPurple[500]} />
      <Text style={styles.stepTitle}>Name This Phone</Text>
      <Text style={styles.stepDesc}>
        This name shows up in the GIAP devices list — pick something you'll
        recognize.
      </Text>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>Device Name</Text>
        <TextInput
          style={styles.textInput}
          value={name}
          onChangeText={setName}
          placeholder="e.g., Emmanuel's iPhone"
          placeholderTextColor={Grey[400]}
        />
      </View>
      <GButton
        variant="primary"
        size="lg"
        disabled={!name.trim()}
        onPress={() => onNext(name.trim())}
      >
        Pair Device
      </GButton>
    </View>
  );
}

/** Step 3: Run handshake + show outcome. */
function CompleteStep({
  state,
  reason,
  onDone,
  onRetry,
}: {
  state: 'pending' | 'ok' | 'error';
  reason: string | null;
  onDone: () => void;
  onRetry: () => void;
}) {
  if (state === 'pending') {
    return (
      <View style={styles.stepContent}>
        <ActivityIndicator size="large" color={JaridaPurple[500]} />
        <Text style={styles.stepTitle}>Pairing…</Text>
        <Text style={styles.stepDesc}>
          Verifying the code and exchanging tokens with your GIAP server.
        </Text>
      </View>
    );
  }
  if (state === 'error') {
    return (
      <View style={styles.stepContent}>
        <GIcon name="x" size={28} color={Semantic.danger} />
        <Text style={styles.stepTitle}>Pairing failed</Text>
        <Text style={styles.stepDesc}>
          {reason ?? 'The server rejected the pairing attempt. Double-check the code and try again.'}
        </Text>
        <GButton variant="primary" size="lg" onPress={onRetry}>
          Try again
        </GButton>
      </View>
    );
  }
  return (
    <View style={styles.stepContent}>
      <GIcon name="check" size={28} color={Semantic.success} />
      <Text style={styles.stepTitle}>All Set!</Text>
      <Text style={styles.stepDesc}>
        Your phone is paired. The session token is stored securely on this
        device and used for every API call.
      </Text>
      <GButton variant="primary" size="lg" onPress={onDone}>
        Go to Home
      </GButton>
    </View>
  );
}

export default function PondPairingScreen() {
  const router = useRouter();
  const { serverUrl, setServerUrl, pair } = useServer();
  const clientIdRef = useRef<string>(randomClientId());

  const [step, setStep] = useState<Step>(0);
  const [code, setCode] = useState('');
  const [completionState, setCompletionState] =
    useState<'pending' | 'ok' | 'error'>('pending');
  const [completionReason, setCompletionReason] = useState<string | null>(null);

  const runPair = useCallback(
    async (deviceName: string) => {
      setStep(3);
      setCompletionState('pending');
      setCompletionReason(null);
      try {
        const resp = await pair({
          clientId: clientIdRef.current,
          pairingCode: code,
          deviceName,
        });
        if (resp.accepted) {
          setCompletionState('ok');
        } else {
          setCompletionState('error');
          setCompletionReason(resp.rejection_reason ?? 'unknown_error');
        }
      } catch (e) {
        setCompletionState('error');
        setCompletionReason((e as Error).message);
      }
    },
    [code, pair],
  );

  const onServerNext = useCallback(
    (url: string) => {
      setServerUrl(url);
      setStep(1);
    },
    [setServerUrl],
  );

  const onCodeNext = useCallback((nextCode: string) => {
    setCode(nextCode);
    setStep(2);
  }, []);

  const done = useCallback(() => router.back(), [router]);

  return (
    <View style={styles.container}>
      <StepIndicator current={step} />
      {step === 0 && <ServerStep initial={serverUrl} onNext={onServerNext} />}
      {step === 1 && <PairingCodeStep onNext={onCodeNext} />}
      {step === 2 && <NameStep onNext={runPair} />}
      {step === 3 && (
        <CompleteStep
          state={completionState}
          reason={completionReason}
          onDone={done}
          onRetry={() => setStep(1)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Grey[50],
    paddingHorizontal: Spacing.lg,
  },

  /* Step indicator */
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xl,
  },
  stepItem: { alignItems: 'center', flex: 1 },
  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Grey[200],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  stepDotActive: { backgroundColor: JaridaPurple[500] },
  stepDotDone: { backgroundColor: Semantic.success },
  stepNumber: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Grey[500],
  },
  stepNumberActive: { color: Brand.white },
  stepLabel: {
    fontFamily: FontFamily.body,
    fontSize: 10,
    color: Grey[500],
  },
  stepLabelActive: {
    color: JaridaPurple[600],
    fontWeight: FontWeight.semibold,
  },

  /* Step content */
  stepContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  stepTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Brand.charcoal,
    textAlign: 'center',
  },
  stepDesc: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Grey[500],
    textAlign: 'center',
    lineHeight: FontSize.base * 1.5,
  },

  /* Device found */
  deviceFound: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Semantic.successSoft,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radii.pill,
  },
  foundDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Semantic.success,
  },
  foundText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Semantic.success,
  },

  /* Input groups */
  inputGroup: { width: '100%' },
  inputLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Grey[700],
    marginBottom: Spacing.xs,
  },
  textInput: {
    backgroundColor: Brand.white,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Grey[200],
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Brand.charcoal,
  },
});
