// The model Goose thinks with, asked about only when the Pond refused to finish without one.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkNotice, InkRow, InkSpinner, InkText, InkTitle } from '@jarida/ink/native';

import { askToDownload, DownloadRow } from '@/components/settings/model-rows';
import { Spacing } from '@/constants/spacing';
import { formatMegabytes, titleOf } from '@/models/model-library';
import { useChoice } from '@/providers/confirm-provider';
import { tap } from '@/services/haptics';
import type { UseOwnerSetup } from '@/view-models/use-owner-setup';
import { useSetupModel } from '@/view-models/use-setup-model';

export function ModelStep({ setup }: { setup: UseOwnerSetup }) {
  const { t } = useTranslation();
  const router = useRouter();
  const choose = useChoice();
  const { choice, unavailable, stalled, retry, library } = useSetupModel(setup);

  const others = (
    <InkButton
      variant="quiet"
      icon="models"
      onPress={() => {
        void tap();
        router.push('/(stack)/models');
      }}
    >
      {t('setup.model.others')}
    </InkButton>
  );

  const body = (() => {
    if (unavailable) return <InkNotice tone="warning">{t('setup.complete.noModelBody')}</InkNotice>;
    if (!choice) return <InkSpinner label={t('setup.model.checking')} />;
    switch (choice.kind) {
      case 'held':
      case 'ready':
        return stalled ? (
          <View style={styles.block}>
            <InkNotice tone="warning">{t('setup.model.stalled', { name: titleOf(choice.model) })}</InkNotice>
            <InkButton variant="primary" block icon="refresh" disabled={setup.saving} onPress={retry}>
              {t('common.retry')}
            </InkButton>
            {others}
          </View>
        ) : (
          <InkSpinner label={t('setup.model.using', { name: titleOf(choice.model) })} />
        );
      case 'downloading':
        return stalled ? (
          <View style={styles.block}>
            <InkNotice tone="warning">{t('setup.model.stalled', { name: titleOf(choice.model) })}</InkNotice>
            <InkButton variant="primary" block icon="refresh" disabled={setup.saving} onPress={retry}>
              {t('common.retry')}
            </InkButton>
          </View>
        ) : (
          <View style={styles.block} accessibilityLiveRegion="polite">
            <InkText>{t('setup.model.downloading', { name: titleOf(choice.model) })}</InkText>
            <DownloadRow
              download={choice.download}
              title={titleOf(choice.model)}
              onControl={(action) => void library.actions.control(choice.download.modelId, action)}
            />
            <InkText size="sm" tone="tertiary">{t('setup.model.finishing')}</InkText>
          </View>
        );
      case 'download': {
        const size = formatMegabytes(choice.model.size_mb);
        return (
          <View style={styles.block}>
            <InkCard raised={false} contentStyle={styles.flush}>
              <InkRow
                label={titleOf(choice.model)}
                description={choice.model.description || t('setup.model.suggested')}
              >
                {size ? <InkText tone="secondary">{size}</InkText> : null}
              </InkRow>
            </InkCard>
            <InkButton
              variant="primary"
              block
              icon="download"
              disabled={library.busy === choice.model.id}
              onPress={() => void askToDownload(choice.model, library.actions.download, choose, t)}
            >
              {size ? t('setup.model.downloadSized', { size }) : t('models.library.download')}
            </InkButton>
            {others}
          </View>
        );
      }
      case 'none':
        return (
          <View style={styles.block}>
            <InkNotice tone="warning">{t('setup.model.none')}</InkNotice>
            {others}
          </View>
        );
    }
  })();

  return (
    <>
      <View style={styles.head}>
        <InkTitle level={2}>{t('setup.model.title')}</InkTitle>
        <InkText tone="secondary">{t('setup.model.lead')}</InkText>
      </View>
      {body}
    </>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.sm },
  block: { gap: Spacing.md },
  flush: { padding: 0 },
});
