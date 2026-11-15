/**
 * SessionsScreen — browse, rename, delete, and resume past conversations.
 *
 * Tap a row to open it in the conversation screen; the pencil icon switches
 * the title into an inline rename field.
 */

import React, { useCallback, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { InkSpinner } from '@/components/ui/ink';
import { useRouter } from 'expo-router';

import { GIcon } from '@/components/ui/g-icon';
import { GKeyboardView, useFocusedInputReveal } from '@/components/ui/g-keyboard-view';
import { GPressable } from '@/components/ui/g-pressable';
import type { SessionSummary } from '@/services/types';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useSessions } from '@/view-models/use-sessions';
import type { ThemeColors } from '@/constants/colors';
import { FontSize, face } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { useConfirm } from '@/providers/confirm-provider';
import { useTheme } from '@/providers/theme-provider';
import i18n from '@/services/i18n';

const SessionRow = React.memo(function SessionRow({
  session,
  onPress,
  onRename,
  onDelete,
}: {
  session: SessionSummary;
  onPress: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const title = session.title?.trim() || i18n.t('sessions.untitled');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  const confirmRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
    setEditing(false);
  };

  return (
    <View style={styles.row}>
      <GPressable onPress={editing ? undefined : onPress} style={styles.rowBody}>
        {editing ? (
          <View style={styles.editRow}>
            <TextInput
              style={styles.editInput}
              value={draft}
              onChangeText={setDraft}
              autoFocus
              placeholderTextColor={colors.textTertiary}
            />
            <GPressable onPress={confirmRename} hitSlop={8}>
              <GIcon name="check" size={18} color={colors.success} />
            </GPressable>
          </View>
        ) : (
          <>
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
            {session.preview ? (
              <Text style={styles.preview} numberOfLines={1}>{session.preview}</Text>
            ) : null}
            <Text style={styles.updatedAt}>{new Date(session.updated_at).toLocaleString()}</Text>
          </>
        )}
      </GPressable>
      {!editing && (
        <View style={styles.actions}>
          <GPressable onPress={() => { setDraft(title); setEditing(true); }} hitSlop={8}>
            <GIcon name="edit" size={16} color={colors.icon} />
          </GPressable>
          <GPressable onPress={onDelete} hitSlop={8}>
            <GIcon name="trash" size={16} color={colors.icon} />
          </GPressable>
        </View>
      )}
    </View>
  );
});

export default function SessionsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { data, loading, actions } = useSessions();
  const pull = usePullToRefresh(actions.refresh);
  const router = useRouter();
  const confirm = useConfirm();
  // A rename opens in place, and a row low in the list would open under the keyboard.
  const list = useRef<FlatList<SessionSummary>>(null);
  const reveal = useFocusedInputReveal(() => list.current?.getNativeScrollRef() as ScrollView | null | undefined);

  const openSession = useCallback(
    (session: SessionSummary) => {
      const title = session.title?.trim();
      router.push({
        pathname: '/conversation',
        params: title ? { session: session.id, title } : { session: session.id },
      });
    },
    [router],
  );

  const confirmDelete = useCallback(
    async (id: string) => {
      const yes = await confirm({
        title: i18n.t('sessions.deleteTitle'),
        message: i18n.t('sessions.deleteBody'),
        confirmLabel: i18n.t('sessions.delete'),
        destructive: true,
      });
      if (yes) actions.remove(id);
    },
    [actions, confirm],
  );

  const renderItem = useCallback(
    ({ item }: { item: SessionSummary }) => (
      <SessionRow
        session={item}
        onPress={() => openSession(item)}
        onRename={(title) => actions.rename(item.id, title)}
        onDelete={() => void confirmDelete(item.id)}
      />
    ),
    [actions, openSession, confirmDelete],
  );

  if (loading && data.sessions.length === 0) {
    return (
      <View style={styles.centered}>
        <InkSpinner label={i18n.t('sessions.loading')} />
      </View>
    );
  }

  return (
    <GKeyboardView>
      <FlatList
        ref={list}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        data={data.sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        {...pull}
        {...reveal}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{i18n.t('sessions.emptyTitle')}</Text>
            <Text style={styles.emptyMessage}>{i18n.t('sessions.emptyMessage')}</Text>
          </View>
        }
      />
    </GKeyboardView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background },
    list: { flex: 1, backgroundColor: c.background },
    listContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: Radii.md,
      padding: Spacing.md,
      marginTop: Spacing.sm,
      gap: Spacing.md,
      borderWidth: 1,
      borderColor: c.border,
    },
    rowBody: { flex: 1 },
    title: {
      ...face('display', 'semibold'),
      fontSize: FontSize.base,
      color: c.text,
    },
    preview: {
      ...face('body', 'regular'),
      fontSize: FontSize.sm,
      color: c.textSecondary,
      marginTop: 2,
    },
    updatedAt: {
      ...face('body', 'regular'),
      fontSize: FontSize.xs,
      color: c.textTertiary,
      marginTop: Spacing.xs,
    },
    actions: {
      flexDirection: 'row',
      gap: Spacing.md,
    },
    editRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    editInput: {
      flex: 1,
      ...face('body', 'regular'),
      fontSize: FontSize.base,
      color: c.text,
      borderBottomWidth: 1,
      borderBottomColor: c.borderStrong,
      paddingVertical: 2,
    },

    empty: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: Spacing.xl * 2,
      gap: Spacing.xs,
    },
    emptyTitle: {
      ...face('display', 'semibold'),
      fontSize: FontSize.base,
      color: c.text,
    },
    emptyMessage: {
      ...face('body', 'regular'),
      fontSize: FontSize.sm,
      color: c.textSecondary,
    },
  });
