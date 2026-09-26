/**
 * PondPairingScreen — 4-step pairing wizard:
 *   0. Find the GIAP server: discovered over mDNS, scanned from the QR, or typed
 *   1. Enter the 6-digit pairing code shown on the GIAP host
 *   2. Name this device
 *   3. Run the two-phase handshake and confirm
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { InkButton } from '@jarida/ink/native';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useFocusEffect, useRouter } from 'expo-router';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { Grey, JaridaPurple, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { ApiError, api } from '@/services/api-client';
import { useServer } from '@/providers/server-provider';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { getInstallId } from '@/services/install-id';
import { takePairingPayload } from '@/services/pairing-handoff';
import { findPondByHost, type DiscoveredPond } from '@/services/discovery';
import { useDiscovery } from '@/view-models/use-discovery';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

type Step = 0 | 1 | 2 | 3;

// Keys, not text: this is evaluated at import, before i18next has a language.
const STEP_KEYS = [
  'pairing.stepFind',
  'pairing.stepCode',
  'pairing.stepName',
  'pairing.stepDone',
] as const;

/** The port from a normalised base URL, defaulting to http's 80 as URL does. */
function portOf(url: string): number {
  const parsed = new URL(url);
  return Number(parsed.port) || 80;
}

/** Step indicator */
function StepIndicator({ current }: { current: Step }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  return (
    <View style={styles.stepRow}>
      {STEP_KEYS.map((key, i) => {
        const label = t(key);
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
 * Offers the camera as an alternative to typing.
 *
 * Both steps keep their text inputs: the scanner is unavailable without camera
 * permission, and a QR that will not decode has to have a way past it.
 */
function ScanLink({ onPress }: { onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  return (
    <GPressable onPress={onPress} hitSlop={8} style={styles.scanLink}>
      <GIcon name="camera" size={16} color={JaridaPurple[500]} />
      <Text style={styles.scanLinkText}>{t('pairing.scanQr')}</Text>
    </GPressable>
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
  const styles = useThemedStyles(makeStyles);
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
  onNext: (url: string) => void;
  onManual: () => void;
  onScan: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { data, error, actions } = useDiscovery();
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  // An advertisement is not a running server. mDNS records outlive the process
  // that registered them, so a restarted hub leaves an entry that resolves and
  // answers nothing — probe before advancing, exactly as manual entry does.
  const pick = useCallback(
    async (pond: DiscoveredPond) => {
      setPicking(pond.id);
      setPickError(null);
      api.setBaseUrl(pond.url);
      const { ok } = await api.health();
      setPicking(null);

      if (!ok) {
        setPickError(
          `${pond.name} is advertising itself but did not answer at ${pond.address}:${pond.port}. It may have been restarted — search again.`,
        );
        return;
      }
      onNext(pond.url);
    },
    [onNext],
  );

  return (
    <StepBody>
      {data.phase === 'searching' ? (
        <ActivityIndicator color={JaridaPurple[500]} />
      ) : (
        <GIcon name="search" size={28} color={JaridaPurple[500]} />
      )}

      <Text style={styles.stepTitle}>
        {data.phase === 'searching' ? t('pond.searching') : t('pairing.addressTitle')}
      </Text>

      {data.phase === 'searching' ? (
        <Text style={styles.stepDesc}>{t('pairing.searching')}</Text>
      ) : null}

      {data.phase === 'empty' ? (
        <Text style={styles.stepDesc}>
          No Pond answered on this network. Check that it is running and that this phone is on
          the same Wi-Fi, or enter its address below.
        </Text>
      ) : null}

      {data.phase === 'failed' ? (
        <Text style={styles.stepError}>
          {error} You can still enter the address by hand.
        </Text>
      ) : null}

      {data.ponds.map((pond) => (
        <GPressable
          feedback="lift"
          key={pond.id}
          style={styles.pondRow}
          disabled={picking !== null}
          onPress={() => void pick(pond)}
        >
          {picking === pond.id ? (
            <ActivityIndicator size="small" color={JaridaPurple[500]} />
          ) : (
            <GIcon name="wifi" size={18} color={JaridaPurple[500]} />
          )}
          <View style={styles.pondInfo}>
            <Text style={styles.pondName} numberOfLines={1}>
              {pond.name}
            </Text>
            <Text style={styles.pondAddr}>
              {pond.address}:{pond.port}
              {pond.version ? ` · v${pond.version}` : ''}
            </Text>
          </View>
        </GPressable>
      ))}

      {pickError ? <Text style={styles.stepError}>{pickError}</Text> : null}

      {data.phase !== 'searching' ? (
        <InkButton variant="quiet" onPress={actions.retry}>
          {t('common.searchAgain')}
        </InkButton>
      ) : null}

      <GPressable onPress={onManual} hitSlop={8} style={styles.scanLink}>
        <Text style={styles.scanLinkText}>{t('pairing.manual')}</Text>
      </GPressable>
      <ScanLink onPress={onScan} />
    </StepBody>
  );
}

/** Step 0, the fallback: type the address in. */
function ServerStep({
  initial,
  onNext,
  onScan,
}: {
  initial: string;
  onNext: (url: string) => void;
  onScan: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const [url, setUrl] = useState(initial);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reach the Pond before advancing. Without this the address is only exercised
  // three steps later, during the handshake, where a typo surfaces as a failed
  // pairing rather than as a bad address on the screen that asked for it.
  const submit = useCallback(async () => {
    const normalized = normalizeServerUrl(url);
    if (!normalized) {
      setError(t('pairing.addressInvalid'));
      return;
    }

    setChecking(true);
    setError(null);
    api.setBaseUrl(normalized);
    const { ok } = await api.health();
    setChecking(false);

    if (!ok) {
      setError(t('pairing.noAnswer', { address: normalized }));
      return;
    }
    onNext(normalized);
  }, [url, onNext, t]);

  return (
    <StepBody>
      <GIcon name="search" size={28} color={JaridaPurple[500]} />
      <Text style={styles.stepTitle}>{t('pairing.addressTitle')}</Text>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>{t('pairing.addressLabel')}</Text>
        <TextInput
          style={styles.textInput}
          value={url}
          onChangeText={(next) => {
            setUrl(next);
            setError(null);
          }}
          placeholder={t('pairing.addressPlaceholder')}
          placeholderTextColor={Grey[400]}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!checking}
        />
      </View>
      {error ? <Text style={styles.stepError}>{error}</Text> : null}
      <InkButton variant="primary" disabled={!url.trim() || checking} onPress={submit}>
        {checking ? t('pairing.searching') : t('common.done')}
      </InkButton>
      <ScanLink onPress={onScan} />
    </StepBody>
  );
}

/** Step 1: the six digits the Pond is showing. */
function PairingCodeStep({
  initial,
  onNext,
  onScan,
}: {
  initial: string;
  onNext: (code: string) => void;
  onScan: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const [code, setCode] = useState(initial);
  const valid = /^\d{6}$/.test(code);
  return (
    <StepBody>
      <GIcon name="wifi" size={28} color={JaridaPurple[500]} />
      <Text style={styles.stepTitle}>{t('pairing.codeTitle')}</Text>
      <Text style={styles.stepDesc}>{t('pairing.codeBody')}</Text>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>{t('pairing.codeLabel')}</Text>
        <TextInput
          style={styles.textInput}
          value={code}
          onChangeText={(next) => setCode(next.replace(/\D/g, '').slice(0, 6))}
          placeholder={t('pairing.codePlaceholder')}
          placeholderTextColor={Grey[400]}
          keyboardType="number-pad"
          autoFocus
        />
      </View>
      <InkButton variant="primary" disabled={!valid} onPress={() => onNext(code)}>
        {t('common.done')}
      </InkButton>
      <ScanLink onPress={onScan} />
    </StepBody>
  );
}

/** Step 2: what this phone is called in the Pond's device list. */
function NameStep({ onNext }: { onNext: (name: string) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const [name, setName] = useState('');
  return (
    <StepBody>
      <GIcon name="edit" size={28} color={JaridaPurple[500]} />
      <Text style={styles.stepTitle}>{t('pairing.nameTitle')}</Text>
      <Text style={styles.stepDesc}>{t('pairing.nameBody')}</Text>
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>{t('pairing.nameLabel')}</Text>
        <TextInput
          style={styles.textInput}
          value={name}
          onChangeText={setName}
          placeholder={t('pairing.namePlaceholder')}
          placeholderTextColor={Grey[400]}
        />
      </View>
      <InkButton variant="primary" disabled={!name.trim()} onPress={() => onNext(name.trim())}>
        {t('screens.pondPairing')}
      </InkButton>
    </StepBody>
  );
}

/**
 * Describe a failure that never reached the verifier — a transport or HTTP
 * error rather than a rejected code.
 *
 * The 429 case is the one that matters. A Pond gives pairing its own rate-limit
 * budget and sends Retry-After when it throttles. Showing "handshake/init
 * failed: 429", which is what this screen used to print, tells a reader nothing
 * and invites them to hammer the button — which is how a phone spends the
 * budget it needs to recover. Naming the wait turns a dead end into an
 * instruction.
 *
 * It takes `t` rather than reaching for a module-level translator: a constant
 * is evaluated at import, before i18next has a language.
 */
function describeTransportFailure(e: unknown, t: TFunction): string {
  if (e instanceof ApiError) {
    if (e.status === 429) {
      const wait = e.retryAfterSecs;
      return wait
        ? t('pairing.rateLimitedWait', { count: wait })
        : t('pairing.rateLimited');
    }
    if (e.status >= 500) return t('pairing.serverError');
    return t('pairing.refused', { status: e.status });
  }
  return t('pairing.unreachable');
}

/**
 * Turn the server's rejection code into something a person can act on.
 *
 * `rejection_reason` is a closed set from pond-core's handshake verifier, and it
 * was rendered raw — someone who mistyped a digit was shown "invalid_mac". The
 * cases are split because they call for different things: a stale challenge only
 * needs the same code re-sent, while an expired code needs a new one fetched
 * from the Pond.
 */
function explainRejection(reason: string | null, t: TFunction): string {
  switch (reason) {
    case 'invalid_mac':
    case 'bad_mac_hex':
      return t('pairing.badCode');
    case 'challenge_expired':
    case 'challenge_used':
    case 'unknown_challenge':
      return t('pairing.expired');
    case 'no_active_pairing_code':
      return t('pairing.noCode');
    default:
      return t('pairing.rejected');
  }
}

/** Step 3: run the handshake, then say how it went. */
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
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();

  if (state === 'pending') {
    return (
      <StepBody>
        <ActivityIndicator size="large" color={JaridaPurple[500]} />
        <Text style={styles.stepTitle}>{t('pairing.pairing')}</Text>
        <Text style={styles.stepDesc}>{t('pairing.pairingBody')}</Text>
      </StepBody>
    );
  }
  if (state === 'error') {
    return (
      <StepBody>
        <GIcon name="x" size={28} color={Semantic.danger} />
        <Text style={styles.stepTitle}>{t('pairing.failed')}</Text>
        <Text style={styles.stepDesc}>{reason ?? t('pairing.rejected')}</Text>
        <InkButton variant="primary" onPress={onRetry}>
          {t('common.retry')}
        </InkButton>
      </StepBody>
    );
  }
  return (
    <StepBody>
      <GIcon name="check" size={28} color={Semantic.success} />
      <Text style={styles.stepTitle}>{t('pairing.done')}</Text>
      <InkButton variant="primary" onPress={onDone}>
        {t('common.goHome')}
      </InkButton>
    </StepBody>
  );
}

export default function PondPairingScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const router = useRouter();
  const { serverUrl, setServerUrl, pair } = useServer();
  // Stable per-install client_id, hydrated from SecureStorage on mount. The
  // server uses this to recognise a returning device and revoke prior tokens
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
   */
  useFocusEffect(
    useCallback(() => {
      const scanned = takePairingPayload();
      if (!scanned) return;

      // Order matters: the mDNS name first because it survives a DHCP lease,
      // the LAN address next because Android cannot resolve that name, and the
      // tailnet address last because at home the LAN hop is direct and needs no
      // VPN running. Away from home it is the only one that answers.
      const candidates = [scanned.serverUrl, scanned.fallbackUrl, scanned.remoteUrl]
        .map((u) => (u ? normalizeServerUrl(u) : null))
        .filter((u): u is string => u !== null);
      if (candidates.length === 0) return;

      void (async () => {
        let reached: string | null = null;
        for (const candidate of candidates) {
          api.setBaseUrl(candidate);
          if ((await api.health()).ok) {
            reached = candidate;
            break;
          }
        }

        // Nothing in the QR was reachable. That is the ordinary outcome on
        // Android for a Pond whose server predates the `ip=` fix: the QR
        // carries only a `.local` name, which this phone cannot resolve, and
        // the code in it is perfectly good. Discovery already knows that hub's
        // numeric address, so look it up by the name the QR did give rather
        // than sending the reader back a step.
        if (!reached) {
          const found = await findPondByHost(scanned.host, portOf(candidates[0]));
          if (found) {
            api.setBaseUrl(found.url);
            if ((await api.health()).ok) reached = found.url;
          }
        }

        // Fall back to showing the first candidate, so an unreachable Pond
        // drops the reader on the step that owns the address with something
        // filled in, rather than failing later as a rejected code.
        const chosen = reached ?? candidates[0];
        api.setBaseUrl(chosen);
        setServerUrl(chosen);
        setCode(scanned.code);
        if (!reached) setManualEntry(true);
        setStep(reached ? 2 : 0);
      })();
    }, [setServerUrl]),
  );

  const [completionState, setCompletionState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [completionReason, setCompletionReason] = useState<string | null>(null);

  const runPair = useCallback(
    async (deviceName: string) => {
      setStep(3);
      setCompletionState('pending');
      setCompletionReason(null);
      try {
        const clientId = clientIdRef.current || (await getInstallId());
        clientIdRef.current = clientId;
        const resp = await pair({ clientId, pairingCode: code, deviceName });
        if (resp.accepted) {
          setCompletionState('ok');
        } else {
          setCompletionState('error');
          setCompletionReason(explainRejection(resp.rejection_reason, t));
        }
      } catch (e) {
        // A throw means the request never reached the verifier, so there is no
        // rejection_reason to explain — only an HTTP or transport failure.
        setCompletionState('error');
        setCompletionReason(describeTransportFailure(e, t));
      }
    },
    [code, pair, t],
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
    <GKeyboardView style={styles.container}>
      <StepIndicator current={step} />
      {step === 0 &&
        (manualEntry ? (
          <ServerStep initial={serverUrl} onNext={onServerNext} onScan={openScanner} />
        ) : (
          <DiscoverStep
            onNext={onServerNext}
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
          onDone={done}
          onRetry={() => setStep(1)}
        />
      )}
    </GKeyboardView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
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
      backgroundColor: c.backgroundSecondary,
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
      color: c.textTertiary,
    },
    stepNumberActive: { color: Brand.white },
    stepLabel: {
      fontFamily: FontFamily.body,
      fontSize: 10,
      color: c.textTertiary,
    },
    stepLabelActive: {
      color: c.textBrand,
      fontWeight: FontWeight.semibold,
    },

    /* Step content. Left-aligned: a wizard reads as a form, and centred body
       copy makes every line start in a different place. */
    stepContent: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: Spacing.lg,
      gap: Spacing.lg,
    },
    stepTitle: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.xl,
      fontWeight: FontWeight.bold,
      color: c.text,
    },
    stepDesc: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.base,
      color: c.textTertiary,
      lineHeight: FontSize.base * 1.5,
    },
    stepError: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      color: Semantic.danger,
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

    // stepContent fills with `flex: 1`, which a scroll view's content container
    // may not use — `flexGrow` keeps that while letting the content grow past
    // the screen.
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
      borderColor: c.border,
      backgroundColor: c.card,
    },
    pondInfo: { flex: 1 },
    pondName: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: c.text,
    },
    pondAddr: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      color: c.textTertiary,
    },

    /* Input groups */
    inputGroup: { width: '100%' },
    inputLabel: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: c.textSecondary,
      marginBottom: Spacing.xs,
    },
    textInput: {
      backgroundColor: c.card,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      fontFamily: FontFamily.body,
      fontSize: FontSize.base,
      color: c.text,
    },
  });
