/**
 * What a Pond just set up is doing about its model: fetching it, warming it, or ready. Home's
 * getting-ready card draws it after setup, which now ends on Home rather than on a screen of its own.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkDots, InkNotice, InkSpinner, InkText } from '@/components/ui/ink';

import { askToDownload, DownloadRow } from '@/components/settings/model-rows';
import { Spacing } from '@/constants/spacing';
import { titleOf } from '@/models/model-library';
import { useChoice } from '@/providers/confirm-provider';
import { tap } from '@/services/haptics';
import type { UsePondReadiness } from '@/view-models/use-pond-readiness';

/** What the Pond is doing about its model, shared by this screen and the card Home shows after it. */
export function ReadinessStatus({ ready }: { ready: UsePondReadiness }) {
  const { t } = useTranslation();
  const router = useRouter();
  const choose = useChoice();
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
          <InkButton variant="quiet" icon="download" onPress={() => void askToDownload(chat, library.actions.download, choose, t)}>
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

const styles = StyleSheet.create({
  block: { gap: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
