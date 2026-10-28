/**
 * AssistantNotesScreen — the Pond's prompt extras: short notes added to the assistant's
 * instructions on every turn. List them, add, reword, switch one off, and delete with a confirm.
 *
 * Reached from the Assistant page's standing instructions. `models/prompt-extras.ts` has how a note
 * reaches the model and why the length advice exists.
 */

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkEmptyState, InkNotice, InkSpinner, InkText } from '@jarida/ink/native';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { LabelledSwitch } from '@/components/patterns/labelled-switch';
import { PromptNoteSheet } from '@/components/patterns/prompt-note-sheet';
import { noteName } from '@/models/prompt-extras';
import { useConfirm } from '@/providers/confirm-provider';
import type { PromptExtra } from '@/services/types';
import { usePromptExtras } from '@/view-models/use-prompt-extras';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

export default function AssistantNotesScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const confirm = useConfirm();
  const { data, loading, error, failed, actions } = usePromptExtras();
  // A refused refresh with the list still on screen is said above it; a list that never arrived is
  // said once, in its place.
  const state = useContentState({ loading, failed: failed || error !== null, hasContent: data.extras.length > 0 });
  const unavailable = isUnavailable(state);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<PromptExtra | null>(null);
  // A new key per opening gives the sheet a fresh form each time.
  const [sheetKey, setSheetKey] = useState(0);

  const openSheet = useCallback((extra: PromptExtra | null) => {
    setEditing(extra);
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  }, []);

  const { remove } = actions;
  const confirmDelete = useCallback(
    async (extra: PromptExtra) => {
      const yes = await confirm({
        title: t('promptNotes.deleteTitle', { name: noteName(extra.key) }),
        message: t('promptNotes.deleteBody'),
        confirmLabel: t('promptNotes.card.delete'),
        destructive: true,
      });
      if (yes) void remove(extra);
    },
    [confirm, t, remove],
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <InkText tone="secondary">{t('promptNotes.intro')}</InkText>
      <InkNotice tone="warning">{t('promptNotes.everyTurn')}</InkNotice>

      <View style={styles.header}>
        <InkButton variant="primary" icon="plus" onPress={() => openSheet(null)}>
          {t('promptNotes.add')}
        </InkButton>
      </View>

      {loading ? <InkSpinner label={t('promptNotes.loading')} /> : null}

      {unavailable ? (
        <ContentUnavailable state={state} reason={error} onRetry={actions.refresh} />
      ) : error ? (
        <InkNotice tone="danger">{error}</InkNotice>
      ) : null}

      {state === 'empty' ? (
        <InkEmptyState icon="prompts" title={t('promptNotes.emptyTitle')}>
          <InkText>{t('promptNotes.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {data.extras.map((extra) => (
        <InkCard key={extra.key}>
          <InkText weight="semibold">{noteName(extra.key)}</InkText>
          <InkText tone={extra.active ? 'default' : 'tertiary'}>{extra.instruction}</InkText>
          <View style={styles.footer}>
            <LabelledSwitch
              label={extra.active ? t('promptNotes.card.on') : t('promptNotes.card.off')}
              checked={extra.active}
              onChange={(active) => void actions.setActive(extra, active)}
            />
            <View style={styles.actions}>
              <InkButton variant="quiet" icon="edit" onPress={() => openSheet(extra)}>
                {t('promptNotes.card.edit')}
              </InkButton>
              <InkButton variant="quiet" icon="trash" onPress={() => confirmDelete(extra)}>
                {t('promptNotes.card.delete')}
              </InkButton>
            </View>
          </View>
        </InkCard>
      ))}

      <PromptNoteSheet
        key={sheetKey}
        open={sheetOpen}
        editing={editing}
        onClose={() => setSheetOpen(false)}
        onAdd={actions.add}
        onEdit={actions.edit}
      />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing['4xl'] },
    header: { flexDirection: 'row', justifyContent: 'flex-end' },
    footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
    actions: { flexDirection: 'row', gap: Spacing.xs },
  });
