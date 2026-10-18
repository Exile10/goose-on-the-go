/**
 * After setup: a fresh Pond may still be fetching or warming its model. Home waits until Goose can
 * answer, unless the household goes on, in which case Home keeps saying it is still getting ready.
 */

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkDots, InkNotice, InkRow, InkSpinner, InkText, InkTitle } from '@jarida/ink/native';

import { askToDownload, DownloadRow } from '@/components/settings/model-rows';
import { Spacing } from '@/constants/spacing';
import { titleOf } from '@/models/model-library';
import { useServer } from '@/providers/server-provider';
import { tap } from '@/services/haptics';
import { usePondReadiness, type UsePondReadiness } from '@/view-models/use-pond-readiness';
import { markGettingReady } from '@/view-models/use-setup-gate';

/** What the Pond is doing about its model, shared by this screen and the card Home shows after it. */
export function ReadinessStatus({ ready }: { ready: UsePondReadiness }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { readiness, chat, download, suggestion, library } = ready;
  switch (readiness) {
    case 'checking':
      return <InkSpinner label={t('setup.ready.checking')} />;
    case 'downloading':
      return (
        <View style={styles.block}>
          <InkText>{t('setup.ready.downloading', { name: chat ? titleOf(chat) : download?.filename ?? '' })}</InkText>
          {download ? (
            <DownloadRow
              download={download}
              title={chat ? titleOf(chat) : download.filename}
              onControl={(action) => void library.actions.control(download.modelId, action)}
            />
          ) : null}
        </View>
      );
    case 'notDownloaded':
      return chat ? (
        <View style={styles.block}>
          <InkText>{t('setup.ready.notDownloaded', { name: titleOf(chat) })}</InkText>
          <InkButton variant="quiet" icon="download" onPress={() => askToDownload(chat, library.actions.download, t)}>
            {t('models.library.download')}
          </InkButton>
        </View>
      ) : null;
    case 'noModel':
      return (
        <View style={styles.block}>
          <InkText>{t('setup.ready.noModel')}</InkText>
          {suggestion ? <InkText tone="secondary">{t('setup.ready.suggestion', { name: titleOf(suggestion) })}</InkText> : null}
          <InkButton
            variant="quiet"
            icon="models"
            onPress={() => {
              void tap();
              router.push('/(stack)/models');
            }}
          >
            {t('setup.ready.chooseModel')}
          </InkButton>
        </View>
      );
    case 'warming':
      return (
        <View style={styles.row}>
          <InkDots label={t('setup.ready.warming')} />
          <InkText>{t('setup.ready.warming')}</InkText>
        </View>
      );
    case 'ready':
      return <InkNotice tone="success">{t('setup.ready.ready')}</InkNotice>;
  }
}

export function SetupReady() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profileId } = useServer();
  const ready = usePondReadiness();
  const done = ready.readiness === 'ready';

  const leave = () => {
    void tap();
    if (profileId) markGettingReady(profileId, !done);
    router.replace('/(tabs)');
  };

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <InkTitle level={1}>{done ? t('setup.ready.titleReady') : t('setup.ready.title')}</InkTitle>
      <View accessibilityLiveRegion="polite">
        <ReadinessStatus ready={ready} />
      </View>
      {ready.library.notice ? <InkNotice tone="danger">{ready.library.notice.text}</InkNotice> : null}
      <InkCard raised={false} contentStyle={styles.flush}>
        <InkRow
          label={t('setup.ready.phone')}
          description={ready.self?.profile ? t('setup.ready.phoneOwner', { name: ready.self.profile.display_name }) : t('setup.ready.phoneNobody')}
        />
      </InkCard>
      <View style={styles.actions}>
        <InkButton variant={done ? 'primary' : 'quiet'} block onPress={leave}>
          {done ? t('setup.ready.goHome') : t('setup.ready.goOn')}
        </InkButton>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, gap: Spacing.xl },
  block: { gap: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  actions: { gap: Spacing.sm },
  flush: { padding: 0 },
});
