import i18n from '@/services/i18n';
import { normalizeHttpsUrl, pinPreview, validPin } from '@/models/connection';
/**
 * PondPairingScreen — 4-step pairing wizard:
 *   0. Find the GIAP server: discovered over mDNS, scanned from the QR, or typed
 *   1. Enter the 6-digit pairing code shown on the GIAP host
 *   2. Name this device
 *   3. Run the two-phase handshake and confirm
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { InkButton, InkIcon } from '@jarida/ink/native';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { Grey, JaridaPurple, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { ApiError } from '@/services/api-client';
import { useServer } from '@/providers/server-provider';
import { getInstallId } from '@/services/install-id';
import { takePairingPayload } from '@/services/pairing-handoff';
import { findPondAt, type DiscoveredPond } from '@/services/discovery';
import { useDiscovery } from '@/view-models/use-discovery';
import { describeApiError } from '@/view-models/describe-error';

type Step = 0 | 1 | 2 | 3;
const STEPS = ['find', 'code', 'name', 'complete'] as const;

/**
 * A step's label, one literal key per branch, as the Memories tabs do: a key assembled at runtime
 * is invisible to services/__tests__/i18n.test.ts, and the exhaustive switch makes TypeScript fail
 * if a step is added without one. These were the one piece of pairing copy the i18n rule could not
 * see, because it sat in an all-caps constant.
 */
function stepLabel(step: (typeof STEPS)[number]): string {
  switch (step) {
    case 'find': return i18n.t('pairing.stepFind');
    case 'code': return i18n.t('pairing.stepCode');
    case 'name': return i18n.t('pairing.stepName');
    case 'complete': return i18n.t('pairing.stepComplete');
  }
}

/** Step indicator */
function StepIndicator({ current }: { current: Step }) {
  return (
    <View style={styles.stepRow}>
      {STEPS.map((step, i) => {
        const isActive = i === current;
        const isDone = i < current;
        return (
          <View key={step} style={styles.stepItem}>
            <View
              style={[
                styles.stepDot,
                isDone && styles.stepDotDone,
                isActive && styles.stepDotActive,
              ]}
            >
              {isDone ? (
                <InkIcon name="check" size={14} />
              ) : (
                <Text style={[styles.stepNumber, isActive && styles.stepNumberActive]}>
                  {i + 1}
                </Text>
              )}
            </View>
            <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>
              {stepLabel(step)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Offers the camera as an alternative to typing.
 *
 * Both steps keep their text inputs: the scanner is unavailable without camera
 * permission, and a QR that will not decode has to have a way past it.
 */
function ScanLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.scanLink}>
      <InkIcon name="camera" size={16} tone="brand" />
      <Text style={styles.scanLinkText}>{i18n.t('pairing.scanInstead')}</Text>
    </Pressable>
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
  try { return normalizeHttpsUrl(raw.trim().includes('://') ? raw.trim() : `https://${raw.trim()}`); }
  catch { return null; }
}

/**
 * The body of one wizard step.
 *
 * It scrolls, which matters for two reasons. The step content is centred, so
 * when the keyboard takes half the screen the button under the focused field
 * ends up below the fold — `GKeyboardView` lifts the container, and this makes
 * what it lifted reachable. And the discovery step grows with however many hubs
 * answer, which is not a number the layout gets to assume.
 */
function StepBody({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      style={styles.stepScroll}
      contentContainerStyle={[styles.stepContent, styles.stepScrollContent]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/**
 * Step 0: find the Pond on this network.
 *
 * The server has always advertised `_pond._tcp.local.`; until now nothing
 * listened, so typing an address was the only way in. Discovery hands back a
 * numeric address, which is the part that matters — Android resolves no mDNS,
 * so a `.local` name is unreachable there however it arrives.
 *
 * Typing and scanning stay, one tap away. Multicast is filtered on plenty of
 * guest and office networks, and a hub that cannot be found still has to be
 * pairable.
 */
function DiscoverStep({
  onNext,
  onManual,
  onScan,
}: {
  onNext: (url: string, pin?: string) => void;
  onManual: () => void;
  onScan: () => void;
}) {
  const { data, error, actions } = useDiscovery();
  // The advertisement already carried a pin, so hand it on rather than making
  // the next step browse for the same record again. It is still only a claim:
  // the next step has the user check it against the Pond's own screen.
  const pick = (pond: DiscoveredPond) => onNext(pond.url, pond.pin);

  return (
    <StepBody>
      {data.phase === 'searching' ? (
        <ActivityIndicator color={JaridaPurple[500]} />
      ) : (
        <InkIcon name="search" size={28} tone="brand" />
      )}

      <Text style={styles.stepTitle}>
        {data.phase === 'searching' ? i18n.t('pairing.searchingTitle') : i18n.t('pairing.connectTitle')}
      </Text>

      {data.phase === 'searching' ? (
        <Text style={styles.stepDesc}>{i18n.t('pairing.searchingDesc')}</Text>
      ) : null}

      {data.phase === 'empty' ? (
        <Text style={styles.stepDesc}>{i18n.t('pairing.noneFound')}</Text>
      ) : null}

      {data.phase === 'failed' ? (
        <Text style={styles.stepError}>{i18n.t('pairing.searchFailed', { error })}</Text>
      ) : null}

      {data.ponds.map((pond) => (
        <Pressable key={pond.id} style={styles.pondRow} onPress={() => pick(pond)}>
          <InkIcon name="wifi" size={18} tone="brand" />
          <View style={styles.pondInfo}>
            <Text style={styles.pondName} numberOfLines={1}>
              {pond.name}
            </Text>
            <Text style={styles.pondAddr}>
              {pond.address}:{pond.port}
              {pond.version ? ` · v${pond.version}` : ''}
            </Text>
          </View>
        </Pressable>
      ))}

      {data.phase !== 'searching' ? (
        <InkButton variant="quiet" onPress={actions.retry}>
          {i18n.t('pairing.searchAgain')}
        </InkButton>
      ) : null}

      <Pressable onPress={onManual} hitSlop={8} style={styles.scanLink}>
        <Text style={styles.scanLinkText}>{i18n.t('pairing.enterManually')}</Text>
      </Pressable>
      <ScanLink onPress={onScan} />
    </StepBody>
  );
}

/**
 * Ask the network for the pin of the Pond at `origin`, so the fingerprint field
 * does not have to be typed.
 *
 * Only the Pond's own advertisement is consulted, and only when the address and
 * port both match what was typed. Resolves null when nothing answers, which is
 * what a network that filters multicast looks like and what a Pond running a
 * server older than the `pin` TXT record looks like; the caller asks for the
 * fingerprint by hand in both cases.
 *
 * A pin learned this way is only a claim. mDNS is unauthenticated, so anything
 * on this network can answer with its own key -- and the handshake cannot catch
 * that: whoever holds the pin terminates TLS, receives the phone's proof, and
 * can recover a six-digit code from it offline in about a second, then forge the
 * Pond's half. So the user confirms the pin against the Pond's own dashboard
 * before it is used (see ServerStep), the out-of-band check that a QR scan or a
 * typed fingerprint already is.
 */
async function discoverFingerprint(origin: string): Promise<string | null> {
  const { hostname, port } = new URL(origin);
  const found = await findPondAt(hostname, Number(port) || 443);
  return found?.pin ?? null;
}

function ServerStep({
  initial,
  initialPin,
  onNext,
  onScan,
}: {
  initial: string;
  /** The pin discovery already learned for `initial`, when it had one. */
  initialPin: string;
  onNext: (url: string, pin: string) => Promise<void>;
  onScan: () => void;
}) {
  const [pin, setPin] = useState(initialPin);
  // A pin that came off the network rather than from the user must be confirmed
  // against the Pond's screen before it is trusted. See discoverFingerprint.
  const [pinFromNetwork, setPinFromNetwork] = useState(!!initialPin);
  const [confirming, setConfirming] = useState<{ url: string; pin: string } | null>(null);
  const [url, setUrl] = useState(initial);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether to ask for the fingerprint at all.
   *
   * Not asked by default, because on a Pond that publishes its pin nobody
   * should have to know what a fingerprint is. An empty field with that label
   * on it reads as required however the hint under it is worded, so the field
   * appears only once the lookup has actually failed and there is nothing else
   * left to try. Arriving with a pin already in hand -- picked off the
   * discovery list -- never asks.
   */
  const [askForPin, setAskForPin] = useState(false);

  // Reach the Pond before advancing. Without this the address is only exercised
  // three steps later, during the handshake, where a typo surfaces as a failed
  // pairing rather than as a bad URL on the screen that asked for it.
  const submit = useCallback(async () => {
    const normalized = normalizeServerUrl(url);
    if (!normalized) {
      setError(i18n.t('pairing.invalid'));
      return;
    }
    setChecking(true); setError(null);
    try {
      // No fingerprint in hand is a request to look one up, not a mistake: the
      // Pond publishes its own pin beside the service phones already discover
      // it by, so the only things anybody should have to read off a screen are
      // the address and the six-digit code.
      let fingerprint = pin.trim();
      if (!fingerprint) {
        const discovered = await discoverFingerprint(normalized);
        if (!discovered) {
          // Only now is there a question worth putting to the user. A Pond
          // running a server older than the pin record looks like this, and so
          // does a network that filters multicast.
          setAskForPin(true);
          setError(i18n.t('pairing.fingerprintMissing'));
          return;
        }
        setPin(discovered);
        setPinFromNetwork(true);
        fingerprint = discovered;
      }
      if (!validPin(fingerprint)) {
        setError(i18n.t('pairing.invalid'));
        return;
      }
      if (pinFromNetwork || fingerprint !== pin.trim()) {
        setConfirming({ url: normalized, pin: fingerprint });
        return;
      }
      await onNext(normalized, fingerprint);
    }
    catch (error) { setError(error instanceof Error ? error.message : i18n.t('pairing.failed')); }
    finally { setChecking(false); }
  }, [url, pin, pinFromNetwork, onNext]);

  const confirmMatch = useCallback(async () => {
    if (!confirming) return;
    setChecking(true); setError(null);
    try { await onNext(confirming.url, confirming.pin); }
    catch (error) { setError(error instanceof Error ? error.message : i18n.t('pairing.failed')); }
    finally { setChecking(false); setConfirming(null); }
  }, [confirming, onNext]);

  const rejectMatch = useCallback(() => {
    setConfirming(null);
    setPin('');
    setPinFromNetwork(false);
    setAskForPin(true);
    setError(i18n.t('pairing.fingerprintMismatch'));
  }, []);

  if (confirming) {
    return (
      <StepBody>
        <InkIcon name="shield" size={28} tone="brand" />
        <Text style={styles.stepTitle}>{i18n.t('pairing.fingerprintConfirmTitle')}</Text>
        <Text style={styles.stepDesc}>{i18n.t('pairing.fingerprintConfirmDesc')}</Text>
        <Text style={styles.pinPreview} selectable>{pinPreview(confirming.pin)}</Text>
        <Text style={styles.stepDesc}>{i18n.t('pairing.fingerprintConfirmWhy')}</Text>
        {error ? <Text style={styles.stepError}>{error}</Text> : null}
        <InkButton variant="primary" disabled={checking} onPress={confirmMatch}>
          {checking ? i18n.t('pairing.fingerprintSearching') : i18n.t('pairing.fingerprintMatches')}
        </InkButton>
        <InkButton variant="quiet" disabled={checking} onPress={rejectMatch}>
          {i18n.t('pairing.fingerprintDiffers')}
        </InkButton>
      </StepBody>
    );
  }

  return (
    <StepBody>
      <InkIcon name="search" size={28} tone="brand" />
      <Text style={styles.stepTitle}>{i18n.t('pairing.connectTitle')}</Text>
      <Text style={styles.stepDesc}>{i18n.t('pairing.connectDesc')}</Text>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>{i18n.t('pairing.serverUrl')}</Text>
        <TextInput
          style={styles.textInput}
          value={url}
          onChangeText={(t) => {
            setUrl(t);
            setError(null);
          }}
          placeholder="https://pond.local:4443"
          placeholderTextColor={Grey[400]}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!checking}
        />
      </View>
      {askForPin ? (
        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>{i18n.t('pairing.fingerprint')}</Text>
          <TextInput style={styles.textInput} value={pin}
            onChangeText={(t) => { setPin(t); setPinFromNetwork(false); setError(null); }}
            placeholder="sha256/..." autoCapitalize="none" autoCorrect={false} editable={!checking} />
          <Text style={styles.stepDesc}>{i18n.t('pairing.fingerprintHint')}</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.stepError}>{error}</Text> : null}
      <InkButton
        variant="primary"
        disabled={!url.trim() || checking}
        onPress={submit}
      >
        {checking ? i18n.t('pairing.fingerprintSearching') : i18n.t('pairing.continueAction')}
      </InkButton>
      <ScanLink onPress={onScan} />
    </StepBody>
  );
}

/** Step 1: Pairing code */
function PairingCodeStep({
  initial,
  onNext,
  onScan,
}: {
  initial: string;
  onNext: (code: string) => void;
  onScan: () => void;
}) {
  const [code, setCode] = useState(initial);
  const valid = /^\d{6}$/.test(code);
  return (
    <StepBody>
      <InkIcon name="wifi" size={28} tone="brand" />
      <Text style={styles.stepTitle}>{i18n.t('pairing.codeTitle')}</Text>
      <Text style={styles.stepDesc}>{i18n.t('pairing.codeDesc')}</Text>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>{i18n.t('pairing.codeLabel')}</Text>
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
      <InkButton
        variant="primary"
        disabled={!valid}
        onPress={() => onNext(code)}
      >
        {i18n.t('pairing.continueAction')}
      </InkButton>
      <ScanLink onPress={onScan} />
    </StepBody>
  );
}

/** Step 2: Name Device */
function NameStep({ onNext }: { onNext: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <StepBody>
      <InkIcon name="edit" size={28} tone="brand" />
      <Text style={styles.stepTitle}>{i18n.t('pairing.nameTitle')}</Text>
      <Text style={styles.stepDesc}>{i18n.t('pairing.nameDesc')}</Text>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>{i18n.t('pairing.nameLabel')}</Text>
        <TextInput
          style={styles.textInput}
          value={name}
          onChangeText={setName}
          placeholder={i18n.t('pairing.namePlaceholder')}
          placeholderTextColor={Grey[400]}
        />
      </View>
      <InkButton
        variant="primary"
        disabled={!name.trim()}
        onPress={() => onNext(name.trim())}
      >
        {i18n.t('pairing.pairDevice')}
      </InkButton>
    </StepBody>
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
/**
 * Describe a failure that never reached the verifier — a transport or HTTP
 * error rather than a rejected code.
 *
 * The 429 case is the one that matters. GIAP gives pairing its own rate-limit
 * budget (30/60s, with /handshake/verify further limited to 10/60s), and it
 * sends Retry-After when it throttles. Showing "handshake/init failed: 429",
 * which is what this screen used to print, tells a user nothing and invites
 * them to hammer the button — which is how a phone spends the budget it needs
 * to recover. Naming the wait turns a dead end into an instruction.
 */
function describeTransportFailure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429) {
      const wait = e.retryAfterSecs;
      return wait
        ? i18n.t('pairingErrors.rateLimited', { count: wait, plural: wait === 1 ? '' : 's' })
        : i18n.t('pairingErrors.rateLimitedNoHint');
    }
    if (e.status >= 500) {
      return i18n.t('pairingErrors.serverError');
    }
    // The wizard runs before there is a session to revoke, so a refusal here
    // is about this attempt and the screen has to say so itself.
    return (
      describeApiError(e) ??
      i18n.t('pairingErrors.refused')
    );
  }
  return i18n.t('pairingErrors.unreachable');
}

function explainRejection(reason: string | null): string {
  switch (reason) {
    case 'invalid_mac':
    case 'bad_mac_hex':
      return i18n.t('pairingErrors.badCode');
    case 'challenge_expired':
    case 'challenge_used':
    case 'unknown_challenge':
      return i18n.t('pairingErrors.expired');
    case 'no_active_pairing_code':
      return i18n.t('pairingErrors.noCode');
    default:
      return i18n.t('pairingErrors.rejected');
  }
}

function CompleteStep({
  state,
  reason,
  onRetry,
}: {
  state: 'pending' | 'error';
  reason: string | null;
  onRetry: () => void;
}) {
  if (state === 'pending') {
    return (
      <StepBody>
        <ActivityIndicator size="large" color={JaridaPurple[500]} />
        <Text style={styles.stepTitle}>{i18n.t('pairing.inProgress')}</Text>
        <Text style={styles.stepDesc}>{i18n.t('pairing.inProgressDesc')}</Text>
      </StepBody>
    );
  }
  if (state === 'error') {
    return (
      <StepBody>
        <InkIcon name="x" size={28} tone="danger" />
        <Text style={styles.stepTitle}>{i18n.t('pairing.failedTitle')}</Text>
        <Text style={styles.stepDesc}>
          {reason ?? i18n.t('pairing.failedDesc')}
        </Text>
        <InkButton variant="primary" onPress={onRetry}>
          {i18n.t('pairing.tryAgain')}
        </InkButton>
      </StepBody>
    );
  }
  // There is no success screen: pairing leaves for Home the moment it
  // succeeds, so the only states this renders are the wait and the failure.
  return (
    <StepBody>
      <ActivityIndicator size="large" color={JaridaPurple[500]} />
      <Text style={styles.stepTitle}>{i18n.t('pairing.inProgress')}</Text>
    </StepBody>
  );
}

export default function PondPairingScreen() {
  const router = useRouter();
  const { serverUrl, stagePairing, cancelPairing, pair, profileId } = useServer();
  /**
   * Whether this screen was reached with somewhere to go back to, decided once.
   *
   * Reached from inside the app to change or repair a pond, there is; reached
   * because there is no pond -- a fresh install, a sign out, or the Pond revoking
   * this phone -- the tab layout redirected here precisely because the app cannot
   * be used, and a back arrow would offer a way to a screen whose every request
   * fails.
   *
   * Captured at mount and never revised, which is the whole point. Binding the
   * header option to the live value crashed the app on every completed pairing:
   * the profile appears and the redirect starts in the same frame, and
   * react-native-screens re-evaluated canNavigateBack on a fragment that was no
   * longer in a stack -- IllegalStateException on the main thread, from
   * ScreenStackHeaderConfig.onUpdate. The condition was right; changing it while
   * the screen was being torn down was not.
   */
  const [reachedWithHistory] = useState(() => Boolean(profileId));
  const [manualUrl, setManualUrl] = useState(serverUrl);
  const [manualPin, setManualPin] = useState('');
  const [pairingError, setPairingError] = useState<string | null>(null);
  useEffect(() => () => { void cancelPairing(); }, [cancelPairing]);
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
  // Step 0 searches the network by default; typing an address is the fallback
  // for a network that filters multicast, which plenty of guest wifi does.
  const [manualEntry, setManualEntry] = useState(false);
  const openScanner = useCallback(() => router.push('/(stack)/connect-desktop'), [router]);

  /**
   * Pick up a scanned payload when the scanner navigates back.
   *
   * The QR carries both halves the wizard would otherwise ask for, so a
   * successful scan skips to naming the device. The server is still probed
   * first: a QR pointing at a host the phone cannot resolve should fail here,
   * not three steps later during the handshake.
   *
   * The mDNS name is tried before the raw address because it is the better one
   * to keep — an address baked into a QR goes stale on the next DHCP lease.
   * Android resolves no mDNS at all, so on that platform the first probe is
   * expected to fail and the fallback is the one that works.
   */
  useFocusEffect(
    useCallback(() => {
      const scanned = takePairingPayload();
      if (!scanned) return;

      let cancelled = false;
      setPairingError(null);
      void stagePairing(scanned.profile, scanned.pin).then(() => {
        if (!cancelled) { setCode(scanned.code); setStep(2); }
      }).catch((error) => {
        if (!cancelled) setPairingError(error instanceof Error ? error.message : i18n.t('pairing.failed'));
      });
      return () => { cancelled = true; };
    }, [stagePairing]),
  );
  const [completionState, setCompletionState] =
    useState<'pending' | 'error'>('pending');
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
          // Leave on success rather than waiting to be dismissed. The wizard
          // has nothing left to say, and the remote access offer it used to
          // push you onto is a dismissible card on Home now.
          router.replace('/(tabs)');
        } else {
          setCompletionState('error');
          setCompletionReason(explainRejection(resp.rejection_reason));
        }
      } catch (e) {
        // A throw means the request never reached the verifier, so there is no
        // rejection_reason to explain — only an HTTP or transport failure.
        setCompletionState('error');
        setCompletionReason(e instanceof ApiError && e.status === 403 ? i18n.t('pairing.lan') : describeTransportFailure(e));
      }
    },
    [code, pair, router],
  );

  const onServerNext = useCallback(async (url: string, pin: string) => {
    const parsed = new URL(url);
    await stagePairing({ version: 2, host: parsed.hostname, port: Number(parsed.port) || 443, localUrls: [url] }, pin);
    setManualUrl(url); setStep(1);
  }, [stagePairing]);

  const onCodeNext = useCallback((nextCode: string) => {
    setCode(nextCode);
    setStep(2);
  }, []);


  return (
    <GKeyboardView style={styles.container}>
      <Stack.Screen options={{ headerBackVisible: reachedWithHistory, gestureEnabled: reachedWithHistory }} />
      <StepIndicator current={step} />
      {pairingError ? <Text style={styles.stepError}>{pairingError}</Text> : null}
      {step === 0 &&
        (manualEntry ? (
          <ServerStep
            initial={manualUrl}
            initialPin={manualPin}
            onNext={onServerNext}
            onScan={openScanner}
          />
        ) : (
          <DiscoverStep
            onNext={(url, pin) => { setManualUrl(url); setManualPin(pin ?? ''); setManualEntry(true); }}
            onManual={() => setManualEntry(true)}
            onScan={openScanner}
          />
        ))}
      {step === 1 && (
        <PairingCodeStep initial={code} onNext={onCodeNext} onScan={openScanner} />
      )}
      {step === 2 && <NameStep onNext={runPair} />}
      {step === 3 && (
        <CompleteStep
          state={completionState}
          reason={completionReason}
          onRetry={() => setStep(1)}
        />
      )}
    </GKeyboardView>
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
  pinPreview: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.lg,
    color: Brand.charcoal,
    textAlign: 'center',
    letterSpacing: 1,
  },
  stepError: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Semantic.danger,
    textAlign: 'center',
    lineHeight: FontSize.sm * 1.5,
  },
  scanLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  scanLinkText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: JaridaPurple[500],
  },

  // stepContent centres with `flex: 1`, which a scroll view's content container
  // may not use — `flexGrow` keeps the centring while letting the content grow
  // past the screen.
  stepScroll: { flex: 1 },
  stepScrollContent: { flex: undefined, flexGrow: 1, paddingVertical: Spacing.lg },

  /* Discovered ponds */
  pondRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Grey[200],
    backgroundColor: Brand.white,
  },
  pondInfo: { flex: 1 },
  pondName: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Brand.charcoal,
  },
  pondAddr: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
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
