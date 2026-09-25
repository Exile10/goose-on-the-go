/**
 * SessionsScreen — browse, rename, delete, and resume past conversations.
 *
 * Tap a row to open it in Chat; the pencil icon switches the title into an
 * inline rename field.
 */

import React, { useCallback, useState } from 'react';
import { InkIcon } from '@jarida/ink/native';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ScreenFlatList } from '@/components/layout/screen-flat-list';
import type { SessionSummary } from '@/services/types';
import { useSessions } from '@/view-models/use-sessions';
import { Brand, Grey, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
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
      <Pressable onPress={editing ? undefined : onPress} style={styles.rowBody}>
        {editing ? (
          <View style={styles.editRow}>
            <TextInput
              style={styles.editInput}
              value={draft}
              onChangeText={setDraft}
              autoFocus
              placeholderTextColor={Grey[400]}
            />
            <Pressable onPress={confirmRename} hitSlop={8}>
              <InkIcon name="check" size={18} tone="success" />
            </Pressable>
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
      </Pressable>
      {!editing && (
        <View style={styles.actions}>
          <Pressable onPress={() => { setDraft(title); setEditing(true); }} hitSlop={8}>
            <InkIcon name="edit" size={16} tone="neutral" />
          </Pressable>
          <Pressable onPress={onDelete} hitSlop={8}>
            <InkIcon name="trash" size={16} tone="neutral" />
          </Pressable>
        </View>
      )}
    </View>
  );
});

export default function SessionsScreen() {
  const { data, loading, actions } = useSessions();
  const router = useRouter();

  const openSession = useCallback(
    (id: string) => {
      router.push({ pathname: '/(tabs)/chat', params: { sessionId: id } });
    },
    [router],
  );

  const confirmDelete = useCallback(
    (id: string) => {
      Alert.alert(i18n.t('sessions.deleteTitle'), i18n.t('sessions.deleteBody'), [
        { text: i18n.t('sessions.cancel'), style: 'cancel' },
        { text: i18n.t('sessions.delete'), style: 'destructive', onPress: () => actions.remove(id) },
      ]);
    },
    [actions],
  );

  const renderItem = useCallback(
    ({ item }: { item: SessionSummary }) => (
      <SessionRow
        session={item}
        onPress={() => openSession(item.id)}
        onRename={(title) => actions.rename(item.id, title)}
        onDelete={() => confirmDelete(item.id)}
      />
    ),
    [actions, openSession, confirmDelete],
  );

  if (loading && data.sessions.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Semantic.info} />
      </View>
    );
  }

  return (
    <ScreenFlatList
      data={data.sessions}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      refreshing={loading}
      onRefresh={actions.refresh}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{i18n.t('sessions.emptyTitle')}</Text>
          <Text style={styles.emptyMessage}>{i18n.t('sessions.emptyMessage')}</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Brand.white,
    borderRadius: Radii.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Grey[200],
  },
  rowBody: { flex: 1 },
  title: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Grey[900],
  },
  preview: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[600],
    marginTop: 2,
  },
  updatedAt: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Grey[400],
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
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Grey[900],
    borderBottomWidth: 1,
    borderBottomColor: Grey[300],
    paddingVertical: 2,
  },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Spacing.xl * 2,
    gap: Spacing.xs,
  },
  emptyTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Grey[700],
  },
  emptyMessage: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
  },
});
