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
import { InkButton } from '@jarida/ink/native';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
} from 'react-native';

import { GIcon } from '@/components/ui/g-icon';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { useProfiles } from '@/view-models/use-profiles';
import type { Profile } from '@/services/types';
import { Grey, JaridaPurple, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import i18n from '@/services/i18n';

/** Fallback when a profile has no emoji, so the avatar is never blank. */
function initial(displayName: string): string {
  return displayName.trim().charAt(0).toUpperCase() || '?';
}

/** Profile card */
const ProfileCard = React.memo(function ProfileCard({
  profile,
  onRemove,
}: {
  profile: Profile;
  onRemove: (id: string) => void;
}) {
  const handleRemove = useCallback(() => onRemove(profile.id), [profile.id, onRemove]);

  return (
    <View style={styles.userCard}>
      <View style={styles.userHeader}>
        <View style={[styles.avatar, { backgroundColor: JaridaPurple[500] }]}>
          <Text style={styles.avatarText}>
            {profile.avatar_emoji || initial(profile.display_name)}
          </Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{profile.display_name}</Text>
        </View>
      </View>

      <View style={styles.actionsRow}>
        <Pressable style={styles.actionBtn} onPress={handleRemove}>
          <GIcon name="trash" size={14} color={Semantic.danger} />
          <Text style={[styles.actionText, { color: Semantic.danger }]}>{i18n.t('addUsers.remove')}</Text>
        </Pressable>
      </View>
    </View>
  );
});

export default function AddUsersScreen() {
  const { data, loading, error, actions } = useProfiles();
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
    <GKeyboardView>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>{i18n.t('addUsers.profiles')}</Text>

        {loading ? <ActivityIndicator color={JaridaPurple[500]} /> : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {!loading && data.profiles.length === 0 ? (
          <Text style={styles.emptyText}>{i18n.t('addUsers.empty')}</Text>
        ) : null}

        {data.profiles.map((p) => (
          <ProfileCard key={p.id} profile={p} onRemove={actions.remove} />
        ))}

        {showAdd ? (
          <View style={styles.inviteCard}>
            <Text style={styles.inviteTitle}>{i18n.t('addUsers.addProfile')}</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{i18n.t('addUsers.name')}</Text>
              <TextInput
                style={styles.textInput}
                value={name}
                onChangeText={setName}
                placeholder={i18n.t('addUsers.namePlaceholder')}
                placeholderTextColor={Grey[400]}
                autoCapitalize="words"
                editable={!saving}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{i18n.t('addUsers.emoji')}</Text>
              <TextInput
                style={styles.textInput}
                value={emoji}
                onChangeText={setEmoji}
                placeholder={i18n.t('addUsers.emojiPlaceholder')}
                placeholderTextColor={Grey[400]}
                editable={!saving}
              />
            </View>
            <View style={styles.inviteActions}>
              <InkButton variant="quiet" onPress={() => setShowAdd(false)}>
                {i18n.t('common.cancel')}
              </InkButton>
              <InkButton
                variant="primary"
                disabled={!name.trim() || saving}
                onPress={submit}
              >
                {saving ? i18n.t('addUsers.adding') : i18n.t('addUsers.add')}
              </InkButton>
            </View>
          </View>
        ) : (
          <Pressable style={styles.addBtn} onPress={() => setShowAdd(true)}>
            <GIcon name="plus" size={16} color={JaridaPurple[500]} />
            <Text style={styles.addBtnText}>{i18n.t('addUsers.add')}</Text>
          </Pressable>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </GKeyboardView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Grey[50] },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

  sectionLabel: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    fontWeight: FontWeight.bold,
    color: Grey[500],
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.md,
  },
  errorText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Semantic.danger,
    marginBottom: Spacing.md,
  },
  emptyText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Grey[500],
    marginBottom: Spacing.md,
  },

  /* User card */
  userCard: {
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Grey[200],
    marginBottom: Spacing.md,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  avatarText: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Brand.white,
  },
  userInfo: { flex: 1 },
  userName: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Brand.charcoal,
  },

  /* Permissions */

  /* Actions */
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Grey[100],
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  actionText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Grey[500],
  },

  /* Add button */
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
    borderRadius: Radii.xl,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: JaridaPurple[200],
    backgroundColor: JaridaPurple[50],
  },
  addBtnText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: JaridaPurple[500],
  },

  /* Invite card */
  inviteCard: {
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: JaridaPurple[200],
  },
  inviteTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Brand.charcoal,
    marginBottom: Spacing.md,
  },
  inputGroup: { marginBottom: Spacing.md },
  inputLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Grey[700],
    marginBottom: Spacing.xs,
  },
  textInput: {
    backgroundColor: Grey[50],
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Grey[200],
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Brand.charcoal,
  },
  inviteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
});
