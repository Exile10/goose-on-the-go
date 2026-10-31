/**
 * WebSearchScreen -- the Pond's Brave Search key, from the phone.
 *
 * A household brings its own key and the Pond holds it. This screen can set it, say what Brave
 * last made of it, and take it away; it can never show it, because the Pond never sends it back.
 * The field is masked and write-only, and empties the moment the Pond has the key.
 *
 * The same content as pond-desktop's `WebSearchPanel` (small-model-tools.md sections 8.5 and
 * 8.10.5), so a key or the Nearby places switch set on either reads the same on both.
 */

import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
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
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { GPressable } from '@/components/ui/g-pressable';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { FontSize, face } from '@/constants/typography';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { BRAVE_DASHBOARD_HOST, townSent, webSearchTone } from '@/models/web-search';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm, reject, tap, toggle } from '@/services/haptics';
import { nearbyNote, statusLabel, useWebSearch } from '@/view-models/use-web-search';

export default function WebSearchScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  // Not `confirm`: that name is the success haptic here.
  const ask = useConfirm();
  const router = useRouter();
  const { data, loading, saving, removing, error, keyError, nearbyError, failed, unsupported, actions } =
    useWebSearch();
  const pull = usePullToRefresh(actions.refresh);

  const busy = saving || removing;
  // The page is a form over the Pond's search setting, so it has content once a read has worked.
  const state = useContentState({ loading, failed, hasContent: !loading && !failed });
  const unavailable = isUnavailable(state);

  const handleSave = useCallback(async () => {
    const saved = await actions.save();
    void (saved ? confirm() : reject());
  }, [actions]);

  const handleRemove = useCallback(async () => {
    const yes = await ask({
      title: t('webSearch.removeConfirmTitle'),
      message: t('webSearch.removeConfirmBody'),
      confirmLabel: t('common.remove'),
      destructive: true,
    });
    if (!yes) return;
    const removed = await actions.remove();
    void (removed ? confirm() : reject());
  }, [actions, ask, t]);

  const handleDashboard = useCallback(() => {
    void tap();
    actions.openDashboard();
  }, [actions]);


  const handleNearby = useCallback(
    async (next: boolean) => {
      void toggle();
      if (!(await actions.setNearby(next))) void reject();
    },
    [actions],
  );

  const handleSetLocation = useCallback(() => {
    void tap();
    router.push('/(stack)/settings-home');
  }, [router]);

  const theme = useInkTheme();
  const town = townSent(data.nearby);

  const errorText = inkText(theme, { size: 'sm', weight: theme.weight.medium, color: theme.color.dangerFg });

  return (
    <GKeyboardView>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pull} />}
      >
        {loading ? <InkSpinner label={t('webSearch.loading')} /> : null}

        {data.status ? (
          // Polite, so a save or a removal is announced as the line changes under it.
          <View accessibilityLiveRegion="polite">
            <InkNotice tone={webSearchTone(data.status)}>{statusLabel(data.status, t)}</InkNotice>
          </View>
        ) : null}

        {unavailable ? (
          <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
        ) : error ? (
          <InkNotice tone="danger">{error}</InkNotice>
        ) : null}

        {unsupported ? <InkNotice tone="warning">{t('webSearch.unsupported')}</InkNotice> : null}

        {!unsupported ? (
          <InkCard contentStyle={styles.card}>
            <InkTitle level={3}>{t('webSearch.keyLabel')}</InkTitle>

            <GPressable
              onPress={handleDashboard}
              hitSlop={8}
              accessibilityRole="link"
              accessibilityHint={t('webSearch.getKeyHint')}
            >
              <Text style={styles.link}>{t('webSearch.getKey', { site: BRAVE_DASHBOARD_HOST })}</Text>
            </GPressable>
            <InkText size="sm" tone="secondary">
              {t('webSearch.help')}
            </InkText>

            <InkInput
              label={t('webSearch.keyLabel')}
              type="password"
              value={data.draft}
              onChange={actions.setDraft}
              onSubmit={() => void handleSave()}
              disabled={busy}
              invalid={keyError ?? undefined}
              placeholder={data.configured ? t('webSearch.keyPlaceholderReplace') : t('webSearch.keyPlaceholder')}
              inputProps={{
                autoComplete: 'off',
                spellCheck: false,
                textContentType: 'none',
                importantForAutofill: 'no',
                returnKeyType: 'done',
              }}
            />

            <View style={data.configured ? styles.actions : styles.actionsEnd}>
              {data.configured ? (
                <InkButton variant="quiet" icon="trash" onPress={() => void handleRemove()} disabled={saving} loading={removing}>
                  {removing ? t('webSearch.removing') : t('common.remove')}
                </InkButton>
              ) : null}
              <InkButton variant="primary" onPress={() => void handleSave()} disabled={!saving && !data.canSave} loading={saving}>
                {saving ? t('webSearch.checking') : t('webSearch.save')}
              </InkButton>
            </View>
          </InkCard>
        ) : null}

        {!unsupported && (data.nearby || data.nearbyUnsupported) ? (
          <InkCard contentStyle={styles.card}>
            <View style={styles.switchRow}>
              <View style={styles.switchWords}>
                <InkTitle level={3}>{t('webSearch.nearby.label')}</InkTitle>
              </View>
              <InkSwitch
                label={t('webSearch.nearby.label')}
                checked={data.nearby?.enabled ?? false}
                onChange={(next) => void handleNearby(next)}
                disabled={!data.canToggleNearby}
              />
            </View>
            <InkText size="sm" tone="secondary">
              {nearbyNote(data.nearby, t)}
            </InkText>
            {nearbyError ? (
              <Text accessibilityRole="alert" style={errorText.style}>
                {nearbyError}
              </Text>
            ) : null}
            {data.nearby && !data.nearby.town ? (
              <View style={styles.actionsStart}>
                <InkButton variant="quiet" icon="home" onPress={handleSetLocation}>
                  {t('webSearch.nearby.setLocation')}
                </InkButton>
              </View>
            ) : null}
          </InkCard>
        ) : null}

        {/* Always on screen, whatever has loaded: what leaves the home is the thing to know first. */}
        <InkText size="sm" tone="secondary">
          {town ? `${t('webSearch.privacy')} ${t('webSearch.townSentence', { town })}` : t('webSearch.privacy')}
        </InkText>
      </ScrollView>
    </GKeyboardView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing['3xl'] },
    card: { gap: Spacing.md },
    link: {
      ...face('body', 'semibold'),
      fontSize: FontSize.base,
      color: c.textBrand,
      textDecorationLine: 'underline',
    },
    actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
    actionsEnd: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.sm },
    actionsStart: { flexDirection: 'row', justifyContent: 'flex-start' },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
    switchWords: { flexShrink: 1 },
  });
