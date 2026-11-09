/**
 * AddUsersScreen — the household profiles this Pond recognises.
 *
 * A profile is how the assistant tells people apart, so it can attribute memory
 * and voice to the right person. It is deliberately not an account: the server
 * stores a display name and an emoji, and nothing else.
 *
 * This screen used to show email addresses, four permission tiers and an invite
 * flow. None of it existed — there is no email field, no role and no invite
 * endpoint — so it has been replaced with what the API actually offers: list,
 * add, remove.
 */

import React, { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  InkButton,
  InkCard,
  InkEmptyState,
  InkFormField,
  InkInput,
  InkListItem,
  InkNotice,
  InkSpinner,
  InkTitle,
  inkText,
  useInkTheme,
} from '@/components/ui/ink';

import { GKeyboardScrollView } from '@/components/ui/g-keyboard-view';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import type { ThemeColors } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { Profile } from '@/services/types';
import { useProfiles } from '@/view-models/use-profiles';

/** Fallback when a profile has no emoji, so the avatar is never blank. */
function initial(displayName: string): string {
  return displayName.trim().charAt(0).toUpperCase() || '?';
}

const AVATAR = 40;

/** One person: their emoji or initial, their name, and the way to forget them. */
const ProfileRow = React.memo(function ProfileRow({
  profile,
  onRemove,
}: {
  profile: Profile;
  onRemove: (id: string) => void;
}) {
  const theme = useInkTheme();
  const { t } = useTranslation();
  const handleRemove = useCallback(() => onRemove(profile.id), [profile.id, onRemove]);
  const mark = inkText(theme, { size: 'lg', weight: theme.weight.bold, color: theme.color.textOnAccent }).style;

  return (
    <InkListItem
      lead={
        // An emoji is not initials, so this is drawn here rather than by InkAvatar.
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: AVATAR,
            height: AVATAR,
            borderRadius: AVATAR / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.color.accent,
          }}
        >
          <Text style={mark}>{profile.avatar_emoji || initial(profile.display_name)}</Text>
        </View>
      }
      title={profile.display_name}
      trail={
        <InkButton size="sm" icon="trash" onPress={handleRemove}>
          {t('common.remove')}
        </InkButton>
      }
    />
  );
});

export default function AddUsersScreen() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const { data, loading, error, actions } = useProfiles();
  const pull = usePullToRefresh(actions.refresh);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    setSaving(true);
    const added = await actions.add(name, emoji.trim() || undefined);
    setSaving(false);
    // Keep the form open on failure so the typed name is not lost.
    if (added) {
      setShowAdd(false);
      setName('');
      setEmoji('');
    }
  }, [actions, name, emoji]);

  return (
    <GKeyboardScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl {...pull} />}
    >
      {loading ? <InkSpinner label={t('people.loading')} /> : null}
      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}

      {!loading && data.profiles.length === 0 ? (
        <InkEmptyState icon="users" title={t('people.empty')}>
          {t('people.emptyBody')}
        </InkEmptyState>
      ) : null}

      {data.profiles.length > 0 ? (
        <InkCard raised={false} contentStyle={styles.list}>
          {data.profiles.map((p) => (
            <ProfileRow key={p.id} profile={p} onRemove={actions.remove} />
          ))}
        </InkCard>
      ) : null}

      {showAdd ? (
        <InkCard contentStyle={styles.form}>
          <InkTitle level={3}>{t('people.addTitle')}</InkTitle>
          <InkFormField label={t('people.name')}>
            <InkInput
              label={t('people.name')}
              value={name}
              onChange={setName}
              placeholder={t('people.namePlaceholder')}
              disabled={saving}
              onSubmit={() => void submit()}
              inputProps={{ autoCapitalize: 'words', autoFocus: true, returnKeyType: 'next' }}
            />
          </InkFormField>
          <InkFormField label={t('people.emoji')} hint={t('people.emojiHint')}>
            <InkInput
              label={t('people.emoji')}
              value={emoji}
              onChange={setEmoji}
              disabled={saving}
              inputProps={{ maxLength: 4 }}
            />
          </InkFormField>
          <View style={styles.formActions}>
            <InkButton disabled={saving} onPress={() => setShowAdd(false)}>
              {t('common.cancel')}
            </InkButton>
            <InkButton variant="primary" disabled={!name.trim()} loading={saving} onPress={() => void submit()}>
              {saving ? t('addUsers.adding') : t('common.add')}
            </InkButton>
          </View>
        </InkCard>
      ) : (
        <InkButton icon="plus" block onPress={() => setShowAdd(true)}>
          {t('people.add')}
        </InkButton>
      )}
    </GKeyboardScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing['3xl'] },
    list: { padding: 0, gap: 0, overflow: 'hidden' },
    form: { gap: Spacing.lg },
    formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
  });
