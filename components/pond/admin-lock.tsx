// My Pond while it is not open: the administrator card's form, or why there is nothing to unlock.
// The tab and every screen under it draw the same one, so a lock found anywhere looks the same.

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkEdge, InkEyebrow, InkNotice, InkSpinner, InkText, InkTitle, inkText, useInkTheme } from '@jarida/ink/native';

import { IconTile, SettingsGroup } from '@/components/settings/settings-list';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import type { IconName } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { FontFamily } from '@/constants/typography';
import { ADMIN_IDLE_MINUTES, ADMIN_PASSWORD_LENGTH } from '@/models/pond-admin';
import { confirm, reject, tap } from '@/services/haptics';
import { useAdminGate, useAdminUnlock } from '@/view-models/use-admin-gate';

/** The commands that make a card and print it again, run on the Pond itself; commands, so not translated. */
// eslint-disable-next-line i18next/no-literal-string -- a command typed on the Pond, not copy
const ADMIN_CARD_COMMAND = 'bash scripts/giap.sh admin-card';
// eslint-disable-next-line i18next/no-literal-string -- a command typed on the Pond, not copy
const SHOW_CARD_COMMAND = 'giap.sh admin-card show';

function CardField({
  value,
  onChange,
  invalid,
  disabled,
  onSubmit,
}: {
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
  disabled: boolean;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const [shown, setShown] = useState(false);
  return (
    <View
      style={[
        styles.frame,
        {
          minHeight: theme.touch.tapMin + theme.space[2],
          paddingLeft: theme.space[3],
          paddingRight: theme.space[1],
          borderWidth: theme.edge.borderWidth,
          borderColor: invalid ? theme.color.danger : theme.color.accentLine,
          borderRadius: theme.radius.md,
          backgroundColor: theme.color.surface,
        },
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChange}
        // Typed off the card, so the hint is the card's own shape.
        placeholder={t('myPond.lock.placeholder')}
        placeholderTextColor={theme.color.textTertiary}
        secureTextEntry={!shown}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        // The card is the proof; nothing asks the phone to keep a copy of it.
        autoComplete="off"
        textContentType="none"
        importantForAutofill="no"
        editable={!disabled}
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        accessibilityLabel={t('myPond.lock.fieldLabel')}
        style={[inkText(theme, { size: 'md', weight: theme.weight.semibold }).style, styles.code, { paddingVertical: theme.space[2] }]}
      />
      <GPressable
        onPress={() => setShown((s) => !s)}
        accessibilityRole="button"
        accessibilityLabel={shown ? t('myPond.lock.hide') : t('myPond.lock.show')}
        style={styles.show}
      >
        <GIcon name={shown ? 'eye-off' : 'eye'} size={20} color={theme.color.textSecondary} />
      </GPressable>
    </View>
  );
}

function LockForm() {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const { gate } = useAdminGate();
  const vm = useAdminUnlock();

  const mistake =
    vm.problem === 'not_on_card' ? t('myPond.lock.notOnCard') : vm.problem === 'long' ? t('myPond.lock.tooLong') : null;
  const cooling = vm.coolingSecs > 0;
  const small = inkText(theme, { size: 'sm', color: theme.color.textSecondary }).style;

  const submit = async () => {
    void tap();
    const ok = await vm.unlock();
    void (ok ? confirm() : reject());
  };

  return (
    <View style={styles.form}>
      {gate.restarting ? <InkNotice tone="neutral">{t('myPond.lock.restarting')}</InkNotice> : null}
      <InkEdge radius={theme.radius.lg} contentStyle={[styles.card, { padding: theme.space[5] }]}>
        <View style={styles.heading}>
          <IconTile icon="key" tile="purple" size={44} />
          <View style={styles.headingText}>
            <InkTitle level={3}>{t('myPond.lock.title')}</InkTitle>
            <InkText size="sm" weight="semibold" tone="secondary">
              {t('myPond.lock.locked')}
            </InkText>
          </View>
        </View>
        <InkText size="md" tone="secondary">
          {t('myPond.lock.intro')}
        </InkText>

        <View style={styles.field}>
          <InkEyebrow>{t('myPond.lock.cardTitle')}</InkEyebrow>
          <CardField
            value={vm.password}
            onChange={vm.setPassword}
            invalid={mistake !== null}
            disabled={vm.unlocking}
            onSubmit={() => void submit()}
          />
          <View style={styles.under} accessibilityLiveRegion="polite">
            <Text style={[small, styles.underHint, mistake ? { color: theme.color.dangerFg } : null]}>
              {mistake ?? t('myPond.lock.cardHint')}
            </Text>
            <Text style={[small, styles.count]}>
              {t('myPond.lock.typed', { typed: Math.min(vm.typed, ADMIN_PASSWORD_LENGTH), total: ADMIN_PASSWORD_LENGTH })}
            </Text>
          </View>
        </View>

        {cooling ? (
          <InkNotice tone="warning">{t('myPond.lock.wait', { count: vm.coolingSecs })}</InkNotice>
        ) : vm.error ? (
          <InkNotice tone="danger">{vm.error}</InkNotice>
        ) : null}
        <InkButton
          variant="primary"
          icon="unlock"
          block
          disabled={vm.problem !== null || vm.unlocking || cooling}
          onPress={() => void submit()}
        >
          {vm.unlocking ? t('myPond.lock.unlocking') : t('myPond.lock.unlock')}
        </InkButton>
      </InkEdge>
    </View>
  );
}

function NoteRow({ icon, children }: { icon: IconName; children: string }) {
  const theme = useInkTheme();
  return (
    <View style={[styles.note, { paddingHorizontal: theme.space[4], paddingVertical: theme.space[3] }]}>
      <GIcon name={icon} size={20} color={theme.color.textSecondary} />
      <InkText size="md" tone="secondary" style={styles.noteText}>
        {children}
      </InkText>
    </View>
  );
}

/** Everything My Pond shows while it is not open. `onRetry` reads the status again. */
export function AdminLockView({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const { gate } = useAdminGate();
  const mono = inkText(theme, { role: 'mono', size: 'sm', color: theme.color.text }).style;
  const chip = { backgroundColor: theme.color.chrome, borderRadius: theme.radius.sm };

  switch (gate.phase) {
    case 'checking':
    case 'unlocked':
      return (
        <View style={styles.centre}>
          <InkSpinner label={t('myPond.lock.checking')} />
        </View>
      );
    case 'unreachable':
      return (
        <View style={styles.form}>
          <InkNotice tone="neutral">{t('myPond.lock.unreachable')}</InkNotice>
          <InkButton variant="quiet" icon="refresh" onPress={onRetry}>
            {t('common.retry')}
          </InkButton>
        </View>
      );
    case 'unsupported':
      return <InkNotice tone="neutral">{t('myPond.lock.unsupported')}</InkNotice>;
    case 'members_only':
      return <InkNotice tone="neutral">{t('myPond.lock.membersOnly')}</InkNotice>;
    case 'no_card':
      return (
        <SettingsGroup>
          <View style={styles.missing}>
            <InkText size="md">{t('myPond.lock.noCard')}</InkText>
            <InkText size="sm" tone="secondary">
              {t('myPond.lock.noCardHow')}
            </InkText>
            <Text selectable style={[mono, styles.command, chip]}>
              {ADMIN_CARD_COMMAND}
            </Text>
          </View>
        </SettingsGroup>
      );
    case 'locked':
      return (
        <>
          <LockForm />
          <SettingsGroup>
            <NoteRow icon="bell">{t('myPond.lock.tellsHousehold')}</NoteRow>
            <NoteRow icon="schedule">{t('myPond.lock.idle', { count: gate.status?.idle_minutes ?? ADMIN_IDLE_MINUTES })}</NoteRow>
          </SettingsGroup>
          <Text style={inkText(theme, { size: 'sm', leading: 'loose', color: theme.color.textSecondary }).style}>
            {t('myPond.lock.lostCard')}{' '}
            <Text selectable style={[mono, chip]}>
              {` ${SHOW_CARD_COMMAND} `}
            </Text>{' '}
            {t('myPond.lock.lostCardAfter')}
          </Text>
        </>
      );
  }
}

const styles = StyleSheet.create({
  form: { gap: Spacing.md, marginBottom: Spacing.xl },
  card: { gap: Spacing.md },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headingText: { flex: 1, gap: 2 },
  field: { gap: Spacing.sm },
  frame: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  // Copied off a printed card group by group, so every character keeps a fixed-width column.
  code: { flex: 1, minWidth: 0, fontFamily: FontFamily.mono, letterSpacing: 1.5 },
  show: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  under: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  underHint: { flex: 1 },
  count: { fontVariant: ['tabular-nums'] },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  noteText: { flex: 1 },
  centre: { alignItems: 'center', paddingVertical: Spacing['2xl'] },
  missing: { gap: Spacing.sm, padding: Spacing.lg },
  command: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, overflow: 'hidden' },
});
