/**
 * NgrokTunnelScreen -- reach the Pond through the household's own ngrok account, from the phone.
 *
 * Four steps take a household from no account to a working tunnel: make an account, let ngrok
 * open TCP addresses, copy the authtoken, paste it here. The switch chooses between the built-in
 * network and ngrok. An unreserved ngrok address changes whenever the tunnel starts and a phone
 * learns it only at home, so away from home the switch needs a reserved address, which is on
 * ngrok's paid plans. The same content as pond-desktop's ngrok panel.
 */

import React, { useCallback } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  InkButton,
  InkCard,
  InkInput,
  InkNotice,
  InkSpinner,
  InkSwitch,
  InkText,
  InkTitle,
  inkText,
  useInkTheme,
} from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { GKeyboardScrollView } from '@/components/ui/g-keyboard-view';
import { GPressable } from '@/components/ui/g-pressable';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { FontSize, face } from '@/constants/typography';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { isUnavailable } from '@/models/content-state';
import {
  NGROK_AUTHTOKEN_URL,
  NGROK_DASHBOARD_URL,
  NGROK_SIGNUP_URL,
  ngrokBlock,
  type RouteState,
} from '@/models/ngrok-tunnel';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm, reject, tap, toggle } from '@/services/haptics';
import { useContentState } from '@/view-models/use-content-state';
import { useNgrokTunnel } from '@/view-models/use-ngrok-tunnel';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

/** The line at the top: which way phones get in now. */
function routeLine(state: RouteState, t: TFunction): { tone: 'success' | 'warning' | 'danger' | 'neutral'; text: string } {
  if (state.fallback) return { tone: 'warning', text: t('ngrok.status.fallback') };
  if (state.route === 'built_in') {
    return state.builtInRunning
      ? { tone: 'neutral', text: t('ngrok.status.builtIn') }
      : { tone: 'neutral', text: t('ngrok.status.builtInOff') };
  }
  switch (state.status.state) {
    case 'running':
      return { tone: 'success', text: t('ngrok.status.running', { address: state.status.address }) };
    case 'starting':
      return { tone: 'neutral', text: t('ngrok.status.starting') };
    case 'failed':
      return { tone: 'danger', text: t('ngrok.status.failed', { reason: state.status.reason }) };
    case 'off':
      return { tone: 'neutral', text: t('ngrok.status.off') };
  }
}

/** Why the switch is held, said under it. */
function blockNote(state: RouteState, t: TFunction): string | null {
  switch (ngrokBlock(state)) {
    case 'noToken':
      return t('ngrok.switch.needsToken');
    case 'awayUnreserved':
      return t('ngrok.switch.awayUnreserved');
    case null:
      return null;
  }
}

export default function NgrokTunnelScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const ask = useConfirm();
  const theme = useInkTheme();
  const vm = useNgrokTunnel();
  const { state, actions } = vm;
  const pull = usePullToRefresh(actions.refresh);
  const content = useContentState({ loading: vm.loading, failed: vm.failed, hasContent: state !== null });
  const unavailable = isUnavailable(content);
  const errorText = inkText(theme, { size: 'sm', weight: theme.weight.medium, color: theme.color.dangerFg });

  const handleSwitch = useCallback(
    async (on: boolean) => {
      void toggle();
      if (!on && state?.route === 'ngrok') {
        const yes = await ask({
          title: t('ngrok.switch.offTitle'),
          message: t('ngrok.switch.offBody'),
          confirmLabel: t('ngrok.switch.offConfirm'),
        });
        if (!yes) return;
      }
      void ((await actions.choose(on ? 'ngrok' : 'built_in')) ? confirm() : reject());
    },
    [actions, ask, state?.route, t],
  );

  const handleSaveToken = useCallback(async () => {
    void ((await actions.saveToken()) ? confirm() : reject());
  }, [actions]);

  const handleRemoveToken = useCallback(async () => {
    const yes = await ask({
      title: t('ngrok.token.removeTitle'),
      message: t('ngrok.token.removeBody'),
      confirmLabel: t('common.remove'),
      destructive: true,
    });
    if (!yes) return;
    void ((await actions.removeToken()) ? confirm() : reject());
  }, [actions, ask, t]);

  const handleSaveAddress = useCallback(async () => {
    void ((await actions.saveAddress()) ? confirm() : reject());
  }, [actions]);

  const link = (label: string, url: string, hint: string) => (
    <GPressable
      onPress={() => {
        void tap();
        actions.open(url);
      }}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityHint={hint}
    >
      <Text style={styles.link}>{label}</Text>
    </GPressable>
  );

  const line = state ? routeLine(state, t) : null;
  const block = state ? blockNote(state, t) : null;
  const home = state?.atHome ?? false;
  const tokenBusy = vm.savingToken || vm.removingToken;

  return (
    <GKeyboardScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl {...pull} />}
    >
      <InkText tone="secondary">{t('ngrok.intro')}</InkText>

      {vm.loading && !state ? <InkSpinner label={t('ngrok.loading')} /> : null}

      {line ? (
        <View accessibilityLiveRegion="polite">
          <InkNotice tone={line.tone}>{line.text}</InkNotice>
        </View>
      ) : null}

      {unavailable ? (
        <ContentUnavailable state={content} reason={vm.error} onRetry={actions.refresh} />
      ) : vm.error ? (
        <InkNotice tone="danger">{vm.error}</InkNotice>
      ) : null}

      {vm.unsupported ? <InkNotice tone="warning">{t('ngrok.unsupported')}</InkNotice> : null}

      {state ? (
        <>
          <InkCard contentStyle={styles.card}>
            <View style={styles.switchRow}>
              <View style={styles.switchWords}>
                <InkTitle level={3}>{t('ngrok.switch.label')}</InkTitle>
                <InkText size="sm" tone="secondary">
                  {state.route === 'ngrok' ? t('ngrok.switch.onHint') : t('ngrok.switch.offHint')}
                </InkText>
              </View>
              <InkSwitch
                label={t('ngrok.switch.label')}
                checked={state.route === 'ngrok'}
                onChange={(next: boolean) => void handleSwitch(next)}
                disabled={vm.switching || (state.route !== 'ngrok' && block !== null)}
              />
            </View>
            {block && state.route !== 'ngrok' ? (
              <InkText size="sm" tone="secondary">
                {block}
              </InkText>
            ) : null}
            {vm.switchError ? (
              <Text accessibilityRole="alert" style={errorText.style}>
                {vm.switchError}
              </Text>
            ) : null}
          </InkCard>

          <InkCard contentStyle={styles.card}>
            <InkTitle level={3}>{t('ngrok.steps.title')}</InkTitle>
            <View style={styles.step}>
              <InkText weight="semibold">{t('ngrok.steps.account')}</InkText>
              {link(t('ngrok.steps.accountLink'), NGROK_SIGNUP_URL, t('ngrok.steps.linkHint'))}
            </View>
            <View style={styles.step}>
              <InkText weight="semibold">{t('ngrok.steps.card')}</InkText>
              <InkText size="sm" tone="secondary">
                {t('ngrok.steps.cardHelp')}
              </InkText>
            </View>
            <View style={styles.step}>
              <InkText weight="semibold">{t('ngrok.steps.token')}</InkText>
              {link(t('ngrok.steps.tokenLink'), NGROK_AUTHTOKEN_URL, t('ngrok.steps.linkHint'))}
            </View>
            <View style={styles.step}>
              <InkText weight="semibold">{t('ngrok.steps.paste')}</InkText>
              <InkText size="sm" tone="secondary">
                {state.tokenSet ? t('ngrok.token.stored') : t('ngrok.token.help')}
              </InkText>
            </View>

            {home ? (
              <>
                <InkInput
                  label={t('ngrok.token.label')}
                  type="password"
                  value={vm.tokenDraft}
                  onChange={actions.setTokenDraft}
                  onSubmit={() => void handleSaveToken()}
                  disabled={tokenBusy}
                  invalid={vm.tokenError ?? undefined}
                  placeholder={state.tokenSet ? t('ngrok.token.placeholderReplace') : t('ngrok.token.placeholder')}
                  inputProps={{
                    autoComplete: 'off',
                    autoCapitalize: 'none',
                    spellCheck: false,
                    textContentType: 'none',
                    importantForAutofill: 'no',
                    returnKeyType: 'done',
                  }}
                />
                <View style={state.tokenSet ? styles.actions : styles.actionsEnd}>
                  {state.tokenSet ? (
                    <InkButton
                      variant="quiet"
                      icon="trash"
                      onPress={() => void handleRemoveToken()}
                      disabled={vm.savingToken}
                      loading={vm.removingToken}
                    >
                      {t('common.remove')}
                    </InkButton>
                  ) : null}
                  <InkButton
                    variant="primary"
                    onPress={() => void handleSaveToken()}
                    disabled={!vm.savingToken && vm.tokenDraft.trim() === ''}
                    loading={vm.savingToken}
                  >
                    {vm.savingToken ? t('ngrok.token.checking') : t('ngrok.token.save')}
                  </InkButton>
                </View>
              </>
            ) : (
              <InkText size="sm" tone="secondary">
                {t('ngrok.token.awayNote')}
              </InkText>
            )}
          </InkCard>

          <InkCard contentStyle={styles.card}>
            <InkTitle level={3}>{t('ngrok.reserved.title')}</InkTitle>
            <InkText size="sm" tone="secondary">
              {t('ngrok.reserved.help')}
            </InkText>
            {link(t('ngrok.reserved.link'), NGROK_DASHBOARD_URL, t('ngrok.steps.linkHint'))}
            {home ? (
              <>
                <InkInput
                  label={t('ngrok.reserved.label')}
                  value={vm.addressDraft}
                  onChange={actions.setAddressDraft}
                  onSubmit={() => void handleSaveAddress()}
                  disabled={vm.savingAddress}
                  invalid={vm.addressError ?? undefined}
                  placeholder={t('ngrok.reserved.placeholder')}
                  inputProps={{ autoCapitalize: 'none', autoCorrect: false, spellCheck: false, returnKeyType: 'done' }}
                />
                <View style={styles.actionsEnd}>
                  <InkButton
                    variant="primary"
                    onPress={() => void handleSaveAddress()}
                    disabled={vm.addressDraft.trim() === (state.reservedAddress ?? '')}
                    loading={vm.savingAddress}
                  >
                    {t('ngrok.reserved.save')}
                  </InkButton>
                </View>
              </>
            ) : (
              <InkText size="sm" tone="secondary">
                {state.reservedAddress
                  ? t('ngrok.reserved.current', { address: state.reservedAddress })
                  : t('ngrok.reserved.awayNote')}
              </InkText>
            )}
          </InkCard>
        </>
      ) : null}

      <InkText size="sm" tone="secondary">
        {t('ngrok.privacy')}
      </InkText>
    </GKeyboardScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing['3xl'] },
    card: { gap: Spacing.md },
    step: { gap: Spacing.xs },
    link: {
      ...face('body', 'semibold'),
      fontSize: FontSize.base,
      color: c.textBrand,
      textDecorationLine: 'underline',
    },
    actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
    actionsEnd: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.sm },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
    switchWords: { flexShrink: 1, gap: Spacing.xs },
  });
