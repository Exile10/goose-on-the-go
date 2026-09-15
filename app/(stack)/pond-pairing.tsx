/**
 * PondPairingScreen — 4-step pairing wizard:
 *   0. Enter the GIAP server URL (LAN address from the dashboard)
 *   1. Enter the 6-digit pairing code shown on the GIAP host
 *   2. Name this device
 *   3. Run the two-phase handshake and confirm
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { api } from '@/services/api-client';
import { useServer } from '@/providers/server-provider';
import { getInstallId } from '@/services/install-id';

type Step = 0 | 1 | 2 | 3;
const STEP_LABELS = ['Server', 'Pairing Code', 'Name Device', 'Complete'];

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

/**
 * Normalise a hand-typed server address, or return null if it cannot be one.
 *
 * The host machine's dashboard shows a bare `host:port`, so a missing scheme is
 * the common case rather than a mistake; it defaults to http, which is what a
 * Pond on the LAN actually serves.
 */
export function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (!parsed.hostname) return null;

  return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, '');
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
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reach the Pond before advancing. Without this the address is only exercised
  // three steps later, during the handshake, where a typo surfaces as a failed
  // pairing rather than as a bad URL on the screen that asked for it.
  const submit = useCallback(async () => {
    const normalized = normalizeServerUrl(url);
    if (!normalized) {
      setError('That does not look like a server address. Try http://pond.local:4000');
      return;
    }

    setChecking(true);
    setError(null);
    api.setBaseUrl(normalized);
    const { ok } = await api.health();
    setChecking(false);

    if (!ok) {
      setError(
        `No Pond answered at ${normalized}. Check the address, and that the phone is on the same network.`,
      );
      return;
    }
    onNext(normalized);
  }, [url, onNext]);

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
          onChangeText={(t) => {
            setUrl(t);
            setError(null);
          }}
          placeholder="http://pond.local:4000"
          placeholderTextColor={Grey[400]}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!checking}
        />
      </View>
      {error ? <Text style={styles.stepError}>{error}</Text> : null}
      <GButton
        variant="primary"
        size="lg"
        disabled={!url.trim() || checking}
        onPress={submit}
      >
        {checking ? 'Checking…' : 'Continue'}
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
/**
 * Turn the server's rejection code into something a person can act on.
 *
 * `rejection_reason` is a closed set from pond-core's handshake verifier, and it
 * was rendered raw — someone who mistyped a digit was shown "invalid_mac". The
 * cases are split because they call for different things: a stale challenge only
 * needs the same code re-sent, while an expired code needs a new one fetched
 * from the Pond.
 *
 * The 60-second challenge lifetime is worth naming rather than folding into a
 * generic retry message. It is far shorter than the code's ten minutes, so it is
 * the limit a user actually hits.
 */
function explainRejection(reason: string | null): string {
  switch (reason) {
    case 'invalid_mac':
    case 'bad_mac_hex':
      return 'That pairing code did not match. Check the six digits on your Pond and try again \u2014 a wrong code costs nothing but this attempt.';
    case 'challenge_expired':
    case 'challenge_used':
    case 'unknown_challenge':
      return 'This attempt took too long \u2014 the server holds a challenge for only 60 seconds. Enter the same code again; you do not need a new one.';
    case 'no_active_pairing_code':
      return 'Your Pond has no pairing code right now. Codes last 10 minutes \u2014 open the dashboard on the host machine to show a fresh one.';
    default:
      return 'The server rejected the pairing attempt. Double-check the code and try again.';
  }
}

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
        <Text style={styles.stepDesc}>{explainRejection(reason)}</Text>
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
  // Stable per-install client_id, hydrated from SecureStorage on mount. The
  // server uses this to recognize a returning device and revoke prior tokens
  // instead of creating a duplicate entry on every re-pair.
  const clientIdRef = useRef<string>('');
  useEffect(() => {
    void getInstallId().then((id) => {
      clientIdRef.current = id;
    });
  }, []);

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
        const clientId = clientIdRef.current || (await getInstallId());
        clientIdRef.current = clientId;
        const resp = await pair({
          clientId,
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
  stepError: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Semantic.danger,
    textAlign: 'center',
    lineHeight: FontSize.sm * 1.5,
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
