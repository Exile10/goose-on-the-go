/**
 * AssistantNotesScreen — the Pond's prompt extras: short notes added to the assistant's
 * instructions on every turn. List them, add, reword, switch one off, and delete with a confirm.
 *
 * Above them, the member's own notes, which only their conversations carry and which the setup
 * interview writes: the same card, and a way into the interview to write or rewrite them.
 *
 * Reached from the Assistant page's standing instructions. `models/prompt-extras.ts` has how a note
 * reaches the model and why the length advice exists.
 */

import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkEmptyState, InkNotice, InkSpinner, InkText, InkTitle } from '@/components/ui/ink';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { isUnavailable } from '@/models/content-state';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { LabelledSwitch } from '@/components/patterns/labelled-switch';
import { PromptNoteSheet } from '@/components/patterns/prompt-note-sheet';
import { topicNameKey } from '@/models/interview';
import { noteName } from '@/models/prompt-extras';
import { useConfirm } from '@/providers/confirm-provider';
import type { PromptExtra } from '@/services/types';
import { useMemberNotes } from '@/view-models/use-member-notes';
import { usePromptExtras } from '@/view-models/use-prompt-extras';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

function NoteCard({
  name,
  extra,
  onActive,
  onEdit,
  onDelete,
}: {
  name: string;
  extra: PromptExtra;
  onActive: (active: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  return (
    <InkCard>
      <InkText weight="semibold">{name}</InkText>
      <InkText tone={extra.active ? 'default' : 'tertiary'}>{extra.instruction}</InkText>
      <View style={styles.footer}>
        <LabelledSwitch label={extra.active ? t('promptNotes.card.on') : t('promptNotes.card.off')} checked={extra.active} onChange={onActive} />
        <View style={styles.actions}>
          <InkButton variant="quiet" icon="edit" onPress={onEdit}>
            {t('promptNotes.card.edit')}
          </InkButton>
          <InkButton variant="quiet" icon="trash" onPress={onDelete}>
            {t('promptNotes.card.delete')}
          </InkButton>
        </View>
      </View>
    </InkCard>
  );
}

export default function AssistantNotesScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const confirm = useConfirm();
  const router = useRouter();
  const { data, loading, error, failed, actions } = usePromptExtras();
  const mine = useMemberNotes();
  // A refused refresh with the list still on screen is said above it; a list that never arrived is
  // said once, in its place.
  const state = useContentState({ loading, failed: failed || error !== null, hasContent: data.extras.length > 0 });
  // One pull reads both lists the screen shows: this member's notes and the household's.
  const { refresh: refreshHousehold } = actions;
  const { refresh: refreshMine } = mine.actions;
  const reload = useCallback(() => Promise.all([refreshHousehold(), refreshMine()]), [refreshHousehold, refreshMine]);
  const pull = usePullToRefresh(reload);
  const unavailable = isUnavailable(state);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<{ extra: PromptExtra; mine: boolean } | null>(null);
  // A new key per opening gives the sheet a fresh form each time.
  const [sheetKey, setSheetKey] = useState(0);

  const openSheet = useCallback((extra: PromptExtra | null, isMine = false) => {
    setEditing(extra ? { extra, mine: isMine } : null);
    setSheetKey((k) => k + 1);
    setSheetOpen(true);
  }, []);

  const nameOf = useCallback(
    (extra: PromptExtra, isMine: boolean) => {
      const topic = isMine ? topicNameKey(extra.key) : null;
      return topic ? t(topic) : noteName(extra.key);
    },
    [t],
  );

  const { remove } = actions;
  const removeMine = mine.actions.remove;
  const confirmDelete = useCallback(
    async (extra: PromptExtra, isMine = false) => {
      const yes = await confirm({
        title: t('promptNotes.deleteTitle', { name: nameOf(extra, isMine) }),
        message: t('promptNotes.deleteBody'),
        confirmLabel: t('promptNotes.card.delete'),
        destructive: true,
      });
      if (yes) void (isMine ? removeMine(extra) : remove(extra));
    },
    [confirm, nameOf, t, remove, removeMine],
  );

  const { ask } = mine.actions;
  const askAbout = useCallback(async () => {
    const opened = await ask();
    if (opened) router.push({ pathname: '/conversation', params: { session: opened.sessionId, interview: opened.profileId } });
  }, [ask, router]);
  const askStatus = mine.data.interview?.status;
  const askLabel =
    askStatus === 'in_progress' || askStatus === 'stopped' || askStatus === 'awaiting_approval'
      ? t('interview.notes.carryOn')
      : askStatus === 'done'
        ? t('interview.notes.askAgain')
        : t('interview.notes.ask');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl {...pull} />}
    >
      <InkNotice tone="warning">{t('promptNotes.everyTurn')}</InkNotice>

      {mine.data.available ? (
        <>
          <InkTitle level={3}>{t('interview.notes.title')}</InkTitle>
          <InkText tone="secondary">{mine.data.notes.length > 0 ? t('interview.notes.lead') : t('interview.notes.empty')}</InkText>
          {mine.error ? <InkNotice tone="danger">{mine.error}</InkNotice> : null}
          {mine.data.notes.map((extra) => (
            <NoteCard
              key={extra.key}
              name={nameOf(extra, true)}
              extra={extra}
              onActive={(active) => void mine.actions.setActive(extra, active)}
              onEdit={() => openSheet(extra, true)}
              onDelete={() => confirmDelete(extra, true)}
            />
          ))}
          <View style={styles.header}>
            <InkButton variant={mine.data.notes.length > 0 ? 'quiet' : 'primary'} icon="chat" onPress={askAbout}>
              {askLabel}
            </InkButton>
          </View>
          <InkTitle level={3}>{t('interview.notes.household')}</InkTitle>
        </>
      ) : null}

      <InkText tone="secondary">{t('promptNotes.intro')}</InkText>

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
        <NoteCard
          key={extra.key}
          name={nameOf(extra, false)}
          extra={extra}
          onActive={(active) => void actions.setActive(extra, active)}
          onEdit={() => openSheet(extra)}
          onDelete={() => confirmDelete(extra)}
        />
      ))}

      <PromptNoteSheet
        key={sheetKey}
        open={sheetOpen}
        editing={editing?.extra ?? null}
        editingName={editing ? nameOf(editing.extra, editing.mine) : undefined}
        onClose={() => setSheetOpen(false)}
        onAdd={actions.add}
        onEdit={editing?.mine ? mine.actions.edit : actions.edit}
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
