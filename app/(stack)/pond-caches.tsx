// What the Pond keeps only to be quicker. Each cache says what clearing it costs before it is cleared.

import React, { useCallback } from 'react';
import { RefreshControl, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkSpinner } from '@jarida/ink/native';

import { AdminLockView } from '@/components/pond/admin-lock';
import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow } from '@/components/settings/settings-list';
import { SettingsNotice, SettingsScroll } from '@/components/settings/settings-scroll';
import { sizeWords } from '@/models/pond-admin';
import { confirm } from '@/services/haptics';
import type { AdminCacheId } from '@/services/types';
import { cacheEffect, cacheLabel } from '@/view-models/pond-admin-words';
import { usePondCaches } from '@/view-models/use-pond-caches';

export default function PondCachesScreen() {
  const { t } = useTranslation();
  const { gate, caches, loading, failed, error, freed, clearing, actions } = usePondCaches();

  const clear = useCallback(
    async (id: AdminCacheId) => {
      if (await actions.clear(id)) void confirm();
    },
    [actions],
  );

  if (gate.phase !== 'unlocked' && gate.phase !== 'checking') {
    return (
      <SettingsScroll typing>
        <AdminLockView onRetry={() => void actions.refresh()} />
      </SettingsScroll>
    );
  }

  return (
    <SettingsScroll refreshControl={<RefreshControl refreshing={false} onRefresh={() => void actions.refresh()} />}>
      <SettingsHeader icon="archive" tile="teal" title={t('screens.pondCaches')} description={t('myPond.caches.intro')} />
      {error && !failed ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}

      {loading ? (
        <InkSpinner label={t('myPond.caches.loading')} />
      ) : failed ? (
        <View>
          <SettingsMessage tone="danger">{error ?? t('myPond.caches.readFailed')}</SettingsMessage>
          <InkButton variant="quiet" icon="refresh" onPress={() => void actions.refresh()}>
            {t('common.retry')}
          </InkButton>
        </View>
      ) : caches.length === 0 ? (
        <SettingsMessage>{t('myPond.caches.none')}</SettingsMessage>
      ) : (
        caches.map((cache) => {
          const freedBytes = freed[cache.id];
          return (
            <SettingsGroup key={cache.id} title={cacheLabel(cache.id)} footer={cacheEffect(cache.id)}>
              <SettingsRow
                label={sizeWords(cache.bytes)}
                description={t('myPond.caches.files', { count: cache.files })}
                note={freedBytes !== undefined ? t('myPond.caches.freed', { size: sizeWords(freedBytes) }) : null}
                trailing={
                  <InkButton
                    variant="quiet"
                    icon="trash"
                    disabled={clearing !== null || cache.bytes === 0}
                    onPress={() => void clear(cache.id)}
                  >
                    {clearing === cache.id ? t('myPond.caches.clearing') : t('myPond.caches.clear')}
                  </InkButton>
                }
              />
            </SettingsGroup>
          );
        })
      )}
    </SettingsScroll>
  );
}
