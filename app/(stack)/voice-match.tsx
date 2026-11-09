/**
 * VoiceMatchScreen -- who the Pond knows by voice, and how to teach it.
 *
 * Every household member is here, whether or not the Pond has their voice. A person opens a sheet to
 * be taught to the Pond in "Teach Goose your voice", taught again, or forgotten. What a
 * known voice is for is said first, because it is what a household wants to know before it enrols:
 * the Pond answers that person with their own context, and a voice never approves anything.
 *
 * The speaker model downloads on its own the first time; the screen shows its progress and its
 * licence credit, and a Pond without Voice Match says so in place of controls that could do nothing.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEmptyState, InkNotice, InkSpinner, InkText } from '@/components/ui/ink';

import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { VoicePrintSheet } from '@/components/patterns/voice-print-sheet';
import { ProgressBar } from '@/components/settings/model-rows';
import { SettingsGroup, SettingsHeader, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsColors, useSettingsStyles, type SettingsType } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { Spacing } from '@/constants/spacing';
import { isUnavailable } from '@/models/content-state';
import { memberStatus } from '@/models/voice-room';
import type { VoicePrintMember } from '@/services/types';
import { selectionTick } from '@/services/haptics';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useVoicePrints } from '@/view-models/use-voice-prints';

export default function VoiceMatchScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useSettingsStyles(makeStyles);
  const colors = useSettingsColors();
  const { data, loading, error, failed, missing, actions } = useVoicePrints();
  const state = useContentState({ loading, failed, hasContent: data.members.length > 0 });
  const [openId, setOpenId] = useState<string | null>(null);

  const open = useMemo(() => data.members.find((m) => m.profile_id === openId) ?? null, [data.members, openId]);
  const model = data.model;
  const ready = model?.state === 'ready';

  const quietRefresh = useCallback(() => actions.refresh(), [actions]);
  const teach = useCallback(
    (member: VoicePrintMember) => {
      setOpenId(null);
      router.push({ pathname: '/teach-voice', params: { profile: member.profile_id, name: member.name, from: 'match' } });
    },
    [router],
  );
  const pull = usePullToRefresh(quietRefresh);

  return (
    <SettingsScroll refreshControl={<RefreshControl {...pull} />}>
      <SettingsHeader icon="users" tile="pink" title={t('screens.voiceMatch')} description={t('voiceMatch.intro')} />

      <View style={styles.facts}>
        <View style={styles.fact}>
          <GIcon name="shield" size={16} color={colors.textTertiary} />
          <Text style={styles.factText}>{t('voiceMatch.neverApproves')}</Text>
        </View>
        <View style={styles.fact}>
          <GIcon name="lock" size={16} color={colors.textTertiary} />
          <Text style={styles.factText}>{t('voiceMatch.privacy')}</Text>
        </View>
      </View>

      {loading && !model && !missing ? <InkSpinner label={t('voiceMatch.loading')} /> : null}

      {isUnavailable(state) && !missing ? <ContentUnavailable state={state} reason={error} onRetry={quietRefresh} /> : null}

      {missing ? (
        <InkEmptyState icon="voice" title={t('voiceMatch.missingTitle')}>
          <InkText>{t('voiceMatch.missingBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {model && !ready ? (
        <SettingsGroup title={t('voiceMatch.model.title')} footer={model.credit || null}>
          <SettingsRow
            label={
              model.state === 'downloading'
                ? t('voiceMatch.model.downloading')
                : model.state === 'failed'
                  ? t('voiceMatch.model.failed')
                  : t('voiceMatch.model.missing')
            }
            description={model.state === 'failed' ? t('voiceMatch.model.failedBody') : t('voiceMatch.model.body')}
            value={model.state === 'downloading' && model.progress !== null ? `${Math.round(model.progress * 100)}%` : null}
          >
            {model.state === 'downloading' ? <ProgressBar fraction={model.progress} /> : null}
          </SettingsRow>
          {model.state === 'failed' || model.state === 'missing' ? (
            <SettingsRow label={t('voiceMatch.model.retry')} icon="download" tile="pink" action onPress={() => void actions.retryModel()} />
          ) : null}
        </SettingsGroup>
      ) : null}

      {!loading && !failed && !missing && data.members.length === 0 ? (
        <InkEmptyState
          icon="users"
          title={t('voiceMatch.emptyTitle')}
          action={
            <InkButton variant="quiet" icon="plus" onPress={() => router.push('/(stack)/add-users')}>
              {t('faces.addPerson')}
            </InkButton>
          }
        >
          <InkText>{t('voiceMatch.emptyBody')}</InkText>
        </InkEmptyState>
      ) : null}

      {data.members.length > 0 ? (
        <SettingsGroup title={t('voiceMatch.people')}>
          {data.members.map((member) => (
            <SettingsRow
              key={member.profile_id}
              label={member.name}
              // The glyph's shape says who the Pond knows; a colour would say more than is true.
              icon={member.enrolled ? 'voice' : 'profile'}
              tile="slate"
              description={memberStatus(member)}
              value={t('voiceMatch.member.takes', { takes: member.takes, needed: member.needed })}
              accessory="next"
              onPress={() => {
                void selectionTick();
                setOpenId(member.profile_id);
              }}
            />
          ))}
        </SettingsGroup>
      ) : null}

      {ready && model.credit ? <InkText size="sm" tone="secondary">{model.credit}</InkText> : null}
      {error && !failed ? <InkNotice tone="danger">{error}</InkNotice> : null}

      <VoicePrintSheet member={open} onClose={() => setOpenId(null)} onTeach={teach} onForget={actions.forget} />
    </SettingsScroll>
  );
}

const makeStyles = (_c: unknown, type: SettingsType) => ({
  facts: { gap: Spacing.sm, marginBottom: Spacing.xl },
  fact: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: Spacing.sm },
  factText: { ...type.prose, flex: 1 },
});
