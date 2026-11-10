/**
 * News settings: whether Goose writes the daily digest and when, whether it writes stories through
 * the day, and whether it reads the digest on the house speaker. Each switch applies as it moves.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkSwitch, InkText, InkTimePicker } from '@jarida/ink/native';

import { GroupRow, InsetGroup } from '@/components/goose/following';
import { ScreenScroll, SectionHead } from '@/components/goose/hub-parts';
import { Spacing } from '@/constants/spacing';
import { clockParts, clockText } from '@/models/news';
import { toggle } from '@/services/haptics';
import { useNewsSettings } from '@/view-models/use-news';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

function SwitchRow({ label, detail, checked, onChange, first }: { label: string; detail: string; checked: boolean; onChange: (v: boolean) => void; first?: boolean }) {
  return (
    <GroupRow
      first={first}
      label={label}
      detail={detail}
      trailing={
        <InkSwitch
          checked={checked}
          label={label}
          onChange={(v) => {
            void toggle();
            onChange(v);
          }}
        />
      }
    />
  );
}

export default function GooseNewsSettingsScreen() {
  const { t } = useTranslation();
  const settings = useNewsSettings();
  const pull = usePullToRefresh(settings.reload);
  const s = settings.data;
  const { save } = settings.actions;
  const at = clockParts(s.digestTime);
  return (
    <ScreenScroll pull={pull}>
      <SectionHead title={t('goose.newsSettings.title')} subtitle={t('goose.newsSettings.subtitle')} />
      <View style={styles.group}>
        <InsetGroup>
          <SwitchRow first label={t('goose.newsSettings.digest')} detail={t('goose.newsSettings.digestBody')} checked={s.digest} onChange={(v) => void save({ digest: v })} />
          <SwitchRow label={t('goose.newsSettings.tiles')} detail={t('goose.newsSettings.tilesBody')} checked={s.tiles} onChange={(v) => void save({ tiles: v })} />
          <SwitchRow label={t('goose.newsSettings.speaker')} detail={t('goose.newsSettings.speakerBody')} checked={s.spokenOnSpeaker} onChange={(v) => void save({ spoken_on_speaker: v })} />
        </InsetGroup>
      </View>
      {s.digest ? (
        <View style={styles.group}>
          <InkTimePicker label={t('goose.newsSettings.time')} value={at} step={15} onChange={(time) => void save({ digest_time: clockText(time.hour, time.minute) })} />
          <InkText size="sm" tone="secondary">
            {s.timezone ? t('goose.newsSettings.timeBodyZone', { zone: s.timezone }) : t('goose.newsSettings.timeBody')}
          </InkText>
        </View>
      ) : null}
      <InkText size="sm" tone="secondary">
        {t('goose.newsSettings.listenNote')}
      </InkText>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.sm },
});
