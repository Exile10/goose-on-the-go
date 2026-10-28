/**
 * SecretsScreen -- the keys the Pond holds for outside services: API keys, tokens, client IDs.
 *
 * Lists them by name, with the catalogue's friendly name where the Pond's own extensions and
 * services define one, and adds, replaces and deletes them. It can never show a value, because the
 * Pond never sends one back: the value field is masked and write-only, and empties on submit.
 *
 * Reached from Settings, Tools, beside Extensions and Web search, whose credentials these are.
 */

import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkNotice, InkSpinner, InkText, InkTitle, inkText, useInkTheme } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { Semantic } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { Radii } from '@/constants/radii';
import { Spacing } from '@/constants/spacing';
import { FontFamily, FontSize } from '@/constants/typography';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { SECRET_KEY_MAX } from '@/models/secrets';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm, reject } from '@/services/haptics';
import { secretName, useSecrets, type SecretRow } from '@/view-models/use-secrets';

export default function SecretsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const theme = useInkTheme();
  // Not `confirm`: that name is the success haptic here.
  const ask = useConfirm();
  const { data, loading, refreshing, saving, deleting, error, formError, notice, failed, actions } = useSecrets();

  const busy = saving || deleting !== null;
  // The page is a form over what the Pond holds, so it has content once a read has worked.
  const state = useContentState({ loading, failed, hasContent: !loading && !failed });
  const unavailable = isUnavailable(state);
  const form = data.form;

  const handleSave = useCallback(async () => {
    const saved = await actions.save();
    void (saved ? confirm() : reject());
  }, [actions]);

  const handleDelete = useCallback(
    async (row: SecretRow) => {
      const yes = await ask({
        title: t('secrets.deleteConfirmTitle', { name: secretName(row) }),
        message: t('secrets.deleteConfirmBody'),
        confirmLabel: t('secrets.delete'),
        destructive: true,
      });
      if (!yes) return;
      const gone = await actions.remove(row.key);
      void (gone ? confirm() : reject());
    },
    [actions, ask, t],
  );

  const handleRefresh = useCallback(() => void actions.refresh(), [actions]);

  const errorText = inkText(theme, { size: 'sm', weight: theme.weight.medium, color: theme.color.dangerFg });
  const replacing = form?.kind === 'replace' ? data.keys.find((row) => row.key === form.key) ?? { key: form.key, labelKey: null } : null;

  return (
    <GKeyboardView>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <InkText size="sm" tone="secondary">
          {t('secrets.intro')}
        </InkText>

        {loading ? <InkSpinner label={t('secrets.loading')} /> : null}

        {/* Polite, so a save or a deletion is announced as the line appears. */}
        <View accessibilityLiveRegion="polite">
          {notice ? <InkNotice tone="success">{notice}</InkNotice> : null}
        </View>

        {unavailable ? (
          <ContentUnavailable state={state} reason={error} onRetry={handleRefresh} />
        ) : error ? (
          <InkNotice tone="danger">{error}</InkNotice>
        ) : null}

        {!loading && !failed ? (
          <InkCard contentStyle={styles.card}>
            <InkTitle level={3}>{t('secrets.storedTitle')}</InkTitle>
            {data.keys.length === 0 ? (
              <InkText size="sm" tone="secondary">
                {t('secrets.empty')}
              </InkText>
            ) : (
              data.keys.map((row) => (
                <View key={row.key} style={styles.row}>
                  <View style={styles.rowText}>
                    <InkText>{secretName(row)}</InkText>
                    {row.labelKey ? <Text style={styles.keyName}>{row.key}</Text> : null}
                  </View>
                  <View style={styles.rowActions}>
                    <InkButton
                      variant="quiet"
                      icon="edit"
                      onPress={() => actions.startReplace(row.key)}
                      disabled={busy}
                    >
                      {t('secrets.replace')}
                    </InkButton>
                    <InkButton
                      variant="quiet"
                      icon="trash"
                      onPress={() => handleDelete(row)}
                      disabled={busy}
                    >
                      {deleting === row.key ? t('secrets.deleting') : t('secrets.delete')}
                    </InkButton>
                  </View>
                </View>
              ))
            )}
            {form ? null : (
              <View style={styles.actionsEnd}>
                <InkButton variant="primary" icon="plus" onPress={actions.startAdd} disabled={busy}>
                  {t('secrets.add')}
                </InkButton>
              </View>
            )}
          </InkCard>
        ) : null}

        {form ? (
          <InkCard contentStyle={styles.card}>
            <InkTitle level={3}>
              {replacing ? t('secrets.replaceTitle', { name: secretName(replacing) }) : t('secrets.addTitle')}
            </InkTitle>

            {form.kind === 'add' ? (
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={data.draftKey}
                  onChangeText={actions.setDraftKey}
                  editable={!busy}
                  maxLength={SECRET_KEY_MAX}
                  accessibilityLabel={t('secrets.keyLabel')}
                  placeholder={t('secrets.keyPlaceholder')}
                  placeholderTextColor={theme.color.textTertiary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  spellCheck={false}
                  returnKeyType="next"
                />
              </View>
            ) : (
              <InkText size="sm" tone="secondary">
                {t('secrets.replaceHelp')}
              </InkText>
            )}

            <View style={[styles.inputRow, formError ? styles.inputRowInvalid : null]}>
              <TextInput
                style={styles.input}
                value={data.draftValue}
                onChangeText={actions.setDraftValue}
                onSubmitEditing={() => void handleSave()}
                secureTextEntry
                editable={!busy}
                accessibilityLabel={t('secrets.valueLabel')}
                placeholder={form.kind === 'replace' ? t('secrets.valuePlaceholderReplace') : t('secrets.valuePlaceholder')}
                placeholderTextColor={theme.color.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                spellCheck={false}
                textContentType="none"
                importantForAutofill="no"
                returnKeyType="done"
              />
            </View>

            {formError ? (
              <Text accessibilityRole="alert" style={errorText.style}>
                {formError}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <InkButton variant="quiet" onPress={actions.cancel} disabled={saving}>
                {t('common.cancel')}
              </InkButton>
              <InkButton variant="primary" onPress={() => void handleSave()} disabled={!data.canSave}>
                {saving ? t('secrets.saving') : t('common.save')}
              </InkButton>
            </View>
          </InkCard>
        ) : null}
      </ScrollView>
    </GKeyboardView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing['3xl'] },
    card: { gap: Spacing.md },
    row: { gap: Spacing.xs },
    rowText: { gap: Spacing.xs },
    rowActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.sm },
    keyName: { fontFamily: FontFamily.mono, fontSize: FontSize.sm, color: c.textSecondary },
    inputRow: {
      backgroundColor: c.backgroundSecondary,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: Spacing.md,
      minHeight: 44,
      justifyContent: 'center',
    },
    inputRowInvalid: { borderColor: Semantic.danger },
    input: {
      fontFamily: FontFamily.mono,
      fontSize: FontSize.base,
      color: c.text,
      paddingVertical: Spacing.sm,
    },
    actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
    actionsEnd: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.sm },
  });
