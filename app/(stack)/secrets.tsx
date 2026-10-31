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
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkInput, InkNotice, InkSpinner, InkText, InkTitle } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { FontSize, face } from '@/constants/typography';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { SECRET_KEY_MAX } from '@/models/secrets';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm, reject } from '@/services/haptics';
import { secretName, useSecrets, type SecretRow } from '@/view-models/use-secrets';

export default function SecretsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  // Not `confirm`: that name is the success haptic here.
  const ask = useConfirm();
  const { data, loading, saving, deleting, error, formError, failed, actions } = useSecrets();
  const pull = usePullToRefresh(actions.refresh);

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


  const replacing = form?.kind === 'replace' ? data.keys.find((row) => row.key === form.key) ?? { key: form.key, labelKey: null } : null;

  return (
    <GKeyboardView>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pull} />}
      >
        <InkText size="sm" tone="secondary">
          {t('secrets.intro')}
        </InkText>

        {loading ? <InkSpinner label={t('secrets.loading')} /> : null}

        {unavailable ? (
          <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
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
              <InkInput
                label={t('secrets.keyLabel')}
                value={data.draftKey}
                onChange={actions.setDraftKey}
                disabled={busy}
                placeholder={t('secrets.keyPlaceholder')}
                inputProps={{
                  maxLength: SECRET_KEY_MAX,
                  autoCapitalize: 'characters',
                  autoCorrect: false,
                  autoComplete: 'off',
                  spellCheck: false,
                  returnKeyType: 'next',
                }}
              />
            ) : (
              <InkText size="sm" tone="secondary">
                {t('secrets.replaceHelp')}
              </InkText>
            )}

            <InkInput
              label={t('secrets.valueLabel')}
              type="password"
              value={data.draftValue}
              onChange={actions.setDraftValue}
              onSubmit={() => void handleSave()}
              disabled={busy}
              invalid={formError ?? undefined}
              placeholder={form.kind === 'replace' ? t('secrets.valuePlaceholderReplace') : t('secrets.valuePlaceholder')}
              inputProps={{
                autoComplete: 'off',
                spellCheck: false,
                textContentType: 'none',
                importantForAutofill: 'no',
                returnKeyType: 'done',
              }}
            />

            <View style={styles.actions}>
              <InkButton variant="quiet" onPress={actions.cancel} disabled={saving}>
                {t('common.cancel')}
              </InkButton>
              <InkButton variant="primary" onPress={() => void handleSave()} disabled={!saving && !data.canSave} loading={saving}>
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
    keyName: { ...face('mono', 'regular'), fontSize: FontSize.sm, color: c.textSecondary },
    actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
    actionsEnd: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.sm },
  });
