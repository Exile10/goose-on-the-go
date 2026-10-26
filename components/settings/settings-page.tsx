/**
 * Draws one page of `SETTINGS_PAGES`: its header, then each section as a group of rows.
 */

import React, { useMemo, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { InkButton, InkSpinner } from '@jarida/ink/native';

import { SETTINGS_PAGES } from '@/constants/settings-pages';
import { Spacing } from '@/constants/spacing';
import type { TranslationKey } from '@/services/i18n';
import {
  type SettingItem,
  type SettingsPageId,
  type SpecialId,
  type SummaryId,
} from '@/models/pond-settings';
import { useTheme } from '@/providers/theme-provider';
import { hapticsEnabled, saveHapticsPreference, selectionTick } from '@/services/haptics';
import type { PondSettings } from '@/services/types';
import { summarize, useSummaryExtras, type Extras } from '@/view-models/use-settings-extras';
import { usePondSettings, type UsePondSettings } from '@/view-models/use-pond-settings';
import {
  listRows,
  MenuRow,
  NumberRow,
  radioRows,
  SliderRow,
  SwitchRow,
  TextRow,
  TimeRow,
} from './setting-controls';
import { SettingsGroup, SettingsHeader, SettingsMessage, SettingsRow, TILE_INSET } from './settings-list';
import {
  LocationRows,
  PostureRow,
  PrimaryProfileRow,
  ProviderRow,
  RetentionOverridesRow,
  RetitleRow,
  SpeechCategoriesRow,
  TimezoneRow,
  ToolModelRow,
  WakeWordResetRow,
} from './special-rows';
import { SettingsScroll } from './settings-scroll';
import { VisionStatusCard, visionEventTypeRows } from './vision-rows';
import { VoicePicker } from './voice-picker';

/** Footers that already say a change waits for a restart, so their rows need not say it again. */
const RESTART_FOOTERS = new Set<TranslationKey>([
  'settings.footer.restartVoice',
  'settings.footer.restartReview',
  'settings.footer.restartTools',
  'settings.footer.exactPosition',
  'settings.footer.embeddings',
  'settings.footer.wakeWord',
]);

/** Specials that draw their own surface, so the page does not put them in a group. */
const BARE_SPECIALS = new Set<SpecialId>(['visionStatus']);

/** Settings that live on this phone, so the page works with no Pond at all. */
const PHONE_PAGES = new Set<SettingsPageId>(['appearance']);

interface Context {
  settings: PondSettings;
  vm: UsePondSettings;
  extras: Extras;
  t: TFunction;
  restartNoted: boolean;
  go: (route: string) => void;
  theme: ReturnType<typeof useTheme>;
  haptics: { on: boolean; set: (next: boolean) => void };
}

function noteFor(item: { restart?: boolean }, ctx: Context): string | null {
  return item.restart && !ctx.restartNoted ? ctx.t('settings.restartNote') : null;
}

function rowsFor(item: SettingItem, i: number, ctx: Context): ReactElement[] {
  const { settings: s, vm, t } = ctx;
  const update = vm.actions.update;
  if (item.kind === 'special') return specialRows(item.id, ctx);
  if (item.kind === 'link') {
    return [
      <SettingsRow
        key={`link:${item.route}`}
        label={t(item.labelKey)}
        icon={item.icon}
        tile={item.tile}
        value={item.summary ? summarize(item.summary, s, ctx.extras, t) : null}
        accessory="next"
        onPress={() => ctx.go(item.route)}
      />,
    ];
  }
  const common = {
    label: t(item.labelKey),
    description: item.hintKey ? t(item.hintKey) : null,
    note: noteFor(item, ctx),
    error: vm.fieldErrors[item.key],
  };
  switch (item.kind) {
    case 'switch':
      return [<SwitchRow key={item.key} {...common} value={s[item.key]} onChange={(next) => void update(item.key, next)} />];
    case 'choice':
      if (item.display === 'menu') {
        return [
          <MenuRow
            key={item.key}
            {...common}
            value={s[item.key]}
            choices={item.options.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            onChange={(next) => void update(item.key, next)}
          />,
        ];
      }
      return radioRows({ name: item.key, value: s[item.key], options: item.options, onChange: (next) => void update(item.key, next), t });
    case 'text': {
      const value = (s[item.key] as string | null) ?? '';
      return [
        <TextRow
          key={item.key}
          {...common}
          value={value}
          placeholder={item.placeholderKey ? t(item.placeholderKey) : undefined}
          multiline={item.multiline}
          address={item.address}
          onCommit={(next) => void update(item.key, (item.nullable && !next ? null : next) as never)}
        />,
      ];
    }
    case 'number':
      return [
        <NumberRow
          key={item.key}
          {...common}
          value={s[item.key]}
          min={item.min}
          max={item.max}
          step={item.step}
          unit={item.unitKey ? t(item.unitKey) : undefined}
          onCommit={(next) => void update(item.key, next)}
        />,
      ];
    case 'slider':
      return [
        <SliderRow
          key={item.key}
          {...common}
          value={s[item.key]}
          min={item.min}
          max={item.max}
          step={item.step}
          format={item.format}
          onCommit={(next) => void update(item.key, next)}
        />,
      ];
    case 'time':
      return [<TimeRow key={item.key} {...common} value={s[item.key]} onCommit={(next) => void update(item.key, next)} />];
    case 'list':
      return listRows({
        name: `${item.key}:${i}`,
        items: s[item.key],
        label: common.label,
        description: common.description,
        emptyText: t(item.emptyKey),
        onChange: (next) => void update(item.key, next),
        t,
      });
  }
}

function specialRows(id: SpecialId, ctx: Context): ReactElement[] {
  const props = { settings: ctx.settings, vm: ctx.vm };
  const { t } = ctx;
  switch (id) {
    case 'voicePicker':
      return [<VoicePicker key={id} vm={ctx.vm} />];
    case 'wakeWordReset':
      return [<WakeWordResetRow key={id} {...props} />];
    case 'timezone':
      return [<TimezoneRow key={id} {...props} />];
    case 'location':
      return [<LocationRows key={id} {...props} />];
    case 'retitle':
      return [<RetitleRow key={id} />];
    case 'retentionOverrides':
      return [<RetentionOverridesRow key={id} {...props} />];
    case 'speechCategories':
      return [<SpeechCategoriesRow key={id} {...props} />];
    case 'toolModel':
      return [<ToolModelRow key={id} {...props} />];
    case 'chatProvider':
      return [<ProviderRow key={id} {...props} field="chat_provider" />];
    case 'llmProvider':
      return [<ProviderRow key={id} {...props} field="llm_provider" />];
    case 'primaryProfile':
      return [<PrimaryProfileRow key={id} {...props} />];
    case 'posture':
      return [<PostureRow key={id} {...props} />];
    case 'visionStatus':
      return [<VisionStatusCard key={id} />];
    case 'visionEventTypes':
      return visionEventTypeRows({ ...props, t });
    case 'theme':
      return radioRows({
        name: 'theme',
        value: ctx.theme.preference,
        options: [
          { value: 'system', labelKey: 'settings.theme.system', hintKey: 'settings.theme.systemHint' },
          { value: 'light', labelKey: 'settings.theme.light' },
          { value: 'dark', labelKey: 'settings.theme.dark' },
        ],
        onChange: (next) => ctx.theme.setPreference(next as 'system' | 'light' | 'dark'),
        t,
      });
    case 'haptics':
      return [
        <SwitchRow key={id} label={t('settings.hapticsLabel')} value={ctx.haptics.on} onChange={ctx.haptics.set} />,
      ];
  }
}

function linkSummaries(id: SettingsPageId): SummaryId[] {
  return SETTINGS_PAGES[id].sections.flatMap((section) =>
    section.items.flatMap((item) => (item.kind === 'link' && item.summary ? [item.summary] : [])),
  );
}

export function SettingsPageScreen({ page: id }: { page: SettingsPageId }) {
  const page = SETTINGS_PAGES[id];
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const vm = usePondSettings();
  const summaryIds = useMemo(() => linkSummaries(id), [id]);
  const extras = useSummaryExtras(summaryIds, vm.settings?.vision_camera_id ?? null);
  const [hapticsOn, setHapticsOn] = useState(hapticsEnabled);
  const phoneOnly = PHONE_PAGES.has(id);
  const settings = vm.settings;

  const go = (route: string) => {
    void selectionTick();
    router.push(route as never);
  };

  let body: React.ReactNode;
  if (!settings && !phoneOnly) {
    body = vm.failed ? (
      <View style={{ alignItems: 'center', gap: Spacing.md }}>
        <SettingsMessage tone="danger">{vm.error ?? t('settings.loadFailed')}</SettingsMessage>
        <InkButton variant="quiet" icon="refresh" onPress={() => void vm.actions.refresh()}>
          {t('common.retry')}
        </InkButton>
      </View>
    ) : (
      <InkSpinner label={t('settings.loading')} />
    );
  } else {
    const ctx: Omit<Context, 'restartNoted'> = {
      settings: settings ?? ({} as PondSettings),
      vm,
      extras,
      t,
      go,
      theme,
      haptics: {
        on: hapticsOn,
        set: (next) => {
          setHapticsOn(next);
          void saveHapticsPreference(next);
        },
      },
    };
    body = page.sections.map((section, s) => {
      const sectionCtx = { ...ctx, restartNoted: !!section.footerKey && RESTART_FOOTERS.has(section.footerKey) };
      // The camera's status card is the page's picture, and wears its own edge rather than sit as a row.
      if (section.items.length === 1 && section.items[0].kind === 'special' && BARE_SPECIALS.has(section.items[0].id)) {
        return <React.Fragment key={`bare-${s}`}>{rowsFor(section.items[0], 0, sectionCtx)}</React.Fragment>;
      }
      const hasTiles = section.items.every((item) => item.kind === 'link' && !!item.icon);
      return (
        <SettingsGroup
          key={section.titleKey ?? `section-${s}`}
          title={section.titleKey ? t(section.titleKey) : null}
          footer={section.footerKey ? t(section.footerKey) : null}
          inset={hasTiles ? TILE_INSET : undefined}
        >
          {section.items.flatMap((item, i) => rowsFor(item, i, sectionCtx))}
        </SettingsGroup>
      );
    });
  }

  return (
    <SettingsScroll typing>
      <SettingsHeader icon={page.icon} tile={page.tile} title={t(page.titleKey)} description={t(page.descriptionKey)} />
      {body}
    </SettingsScroll>
  );
}
