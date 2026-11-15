/**
 * Ideas from screenshots: the opt-in, what happens to a screenshot said in full whether it is on
 * or off, sending the ones the member chooses, and every line the Pond kept, to delete.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkNotice, InkSpinner, InkSwitch, InkText } from '@/components/ui/ink';

import { ListSection, SentenceRow } from '@/components/goose/about-parts';
import { InsetGroup } from '@/components/goose/following';
import { RoundButton, ScreenScroll } from '@/components/goose/hub-parts';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { DangerQuietButton } from '@/components/pond/danger-quiet-button';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { isUnavailable } from '@/models/content-state';
import { useConfirm } from '@/providers/confirm-provider';
import { toggle } from '@/services/haptics';
import type { TranslationKey } from '@/services/i18n';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';
import { useScreenshots } from '@/view-models/use-screenshots';

const PRIVACY: { key: TranslationKey; icon: IconName }[] = [
  { key: 'goose.shots.privacy1', icon: 'eye' },
  { key: 'goose.shots.privacy2', icon: 'not-kept' },
  { key: 'goose.shots.privacy3', icon: 'lock' },
  { key: 'goose.shots.privacy4', icon: 'trash' },
];

export default function GooseScreenshotsScreen() {
  const { t } = useTranslation();
  const ask = useConfirm();
  const shots = useScreenshots();
  const pull = usePullToRefresh(shots.actions.reload);
  const { enabled, available, pending, notes } = shots.data;
  // The switch is the content: once the Pond has answered there is always something to show.
  const state = useContentState({ loading: shots.loading, failed: shots.failed, hasContent: !shots.loading && !shots.failed });
  const known = state === 'ready';

  const removeAll = async () => {
    const yes = await ask({
      title: t('goose.shots.deleteAllConfirmTitle'),
      message: t('goose.shots.deleteAllConfirmBody'),
      confirmLabel: t('goose.shots.deleteAll'),
      destructive: true,
    });
    if (yes) void shots.actions.removeAll();
  };

  return (
    <ScreenScroll pull={pull} gap={Spacing.xl}>
      <InkText tone="secondary">{t('goose.shots.lead')}</InkText>
      {state === 'loading' ? <InkSpinner label={t('goose.shots.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={shots.error} onRetry={shots.actions.reload} /> : null}
      {known ? (
        <View style={styles.section}>
          <InsetGroup>
            <SentenceRow
              first
              text={t('goose.shots.toggle')}
              trailing={
                <InkSwitch
                  label={t('goose.shots.toggle')}
                  checked={enabled}
                  // Nothing to turn on without a model that reads pictures; turning it off always works.
                  disabled={!available && !enabled}
                  onChange={(on) => {
                    void toggle();
                    void shots.actions.setEnabled(on);
                  }}
                />
              }
            />
          </InsetGroup>
          {available ? null : (
            <InkText size="sm" tone="secondary">
              {t('goose.shots.unavailable')}
            </InkText>
          )}
        </View>
      ) : null}

      <ListSection title={t('goose.shots.privacyTitle')}>
        <InsetGroup>
          {PRIVACY.map((line, i) => (
            <SentenceRow key={line.key} first={i === 0} icon={line.icon} text={t(line.key)} />
          ))}
        </InsetGroup>
      </ListSection>

      {known && enabled && available ? (
        <View style={styles.section}>
          <InkButton variant="primary" icon="photo" loading={shots.sending} disabled={shots.room === 0} onPress={() => void shots.actions.choose()} style={styles.left}>
            {shots.sending ? t('goose.shots.adding') : t('goose.shots.add')}
          </InkButton>
          {shots.sent || pending > 0 ? (
            <View accessibilityLiveRegion="polite" style={styles.status}>
              {shots.sent ? (
                <InkText size="sm" tone="secondary">
                  {t('goose.shots.sent', { count: shots.sent })}
                </InkText>
              ) : null}
              {pending > 0 ? (
                <InkText size="sm" tone="secondary">
                  {t('goose.shots.waiting', { count: pending })}
                </InkText>
              ) : null}
            </View>
          ) : null}
          {shots.room === 0 ? <InkNotice>{t('goose.shots.full')}</InkNotice> : null}
        </View>
      ) : null}

      {known ? (
        <ListSection title={t('goose.shots.notesTitle')}>
          {notes.length ? (
            <>
              <InsetGroup>
                {notes.map((note, i) => (
                  <SentenceRow
                    key={note.id}
                    first={i === 0}
                    text={note.note}
                    detail={note.usedAt ? t('goose.shots.used') : null}
                    trailing={<RoundButton icon="trash" size={30} label={t('goose.shots.delete')} onPress={() => void shots.actions.remove(note)} />}
                  />
                ))}
              </InsetGroup>
              <View style={styles.left}>
                <DangerQuietButton icon="trash" disabled={shots.clearing} onPress={() => void removeAll()}>
                  {t('goose.shots.deleteAll')}
                </DangerQuietButton>
              </View>
            </>
          ) : (
            <InkText tone="secondary">{t('goose.shots.emptyNotes')}</InkText>
          )}
        </ListSection>
      ) : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  status: { gap: 2 },
  left: { alignSelf: 'flex-start' },
});
