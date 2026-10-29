// My Pond while it is not open: the administrator card's form, or why there is nothing to unlock.
// The tab and every screen under it draw the same one, so a lock found anywhere looks the same.

import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkNotice, InkSpinner, InkText, inkText, useInkTheme } from '@jarida/ink/native';

import { SettingsGroup } from '@/components/settings/settings-list';
import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { FontFamily } from '@/constants/typography';
import { ADMIN_PASSWORD_LENGTH } from '@/models/pond-admin';
import { confirm, reject, tap } from '@/services/haptics';
import { useAdminGate, useAdminUnlock } from '@/view-models/use-admin-gate';

/** The command that makes a card, run on the Pond itself; a command, so it is not translated. */
// eslint-disable-next-line i18next/no-literal-string -- a command typed on the Pond, not copy
const ADMIN_CARD_COMMAND = 'bash scripts/giap.sh admin-card';

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
          minHeight: theme.touch.tapMin,
          paddingHorizontal: theme.space[3],
          borderWidth: theme.edge.hairlineWidth,
          borderColor: invalid ? theme.color.danger : theme.color.lineStrong,
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
        style={[inkText(theme, { size: 'md' }).style, styles.code, { paddingVertical: theme.space[2] }]}
      />
      <GPressable
        hitSlop={8}
        onPress={() => setShown((s) => !s)}
        accessibilityRole="button"
        accessibilityLabel={shown ? t('myPond.lock.hide') : t('myPond.lock.show')}
      >
        <GIcon name={shown ? 'eye-off' : 'eye'} size={18} />
      </GPressable>
    </View>
  );
}

function LockForm() {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const { gate } = useAdminGate();
  const vm = useAdminUnlock();

  const hint =
    vm.problem === 'not_on_card'
      ? t('myPond.lock.notOnCard')
      : vm.problem === 'long'
        ? t('myPond.lock.tooLong')
        : vm.problem === 'short'
          ? t('myPond.lock.typed', { typed: vm.typed, total: ADMIN_PASSWORD_LENGTH })
          : null;
  const mistaken = vm.problem === 'not_on_card' || vm.problem === 'long';
  const cooling = vm.coolingSecs > 0;

  const submit = async () => {
    void tap();
    const ok = await vm.unlock();
    void (ok ? confirm() : reject());
  };

  return (
    <View style={styles.form}>
      {gate.restarting ? <InkNotice tone="neutral">{t('myPond.lock.restarting')}</InkNotice> : null}
      <View style={styles.intro}>
        <GIcon name="lock" size={28} color={theme.color.textSecondary} />
        <InkText size="md">{t('myPond.lock.intro')}</InkText>
        <InkText size="sm" style={{ color: theme.color.textSecondary }}>
          {t('myPond.lock.where')}
        </InkText>
      </View>
      <CardField value={vm.password} onChange={vm.setPassword} invalid={mistaken} disabled={vm.unlocking} onSubmit={() => void submit()} />
      {hint ? (
        <View accessibilityLiveRegion="polite">
          <InkText size="sm" style={{ color: mistaken ? theme.color.danger : theme.color.textTertiary }}>
            {hint}
          </InkText>
        </View>
      ) : null}
      {cooling ? (
        <InkNotice tone="warning">{t('myPond.lock.wait', { count: vm.coolingSecs })}</InkNotice>
      ) : vm.error ? (
        <InkNotice tone="danger">{vm.error}</InkNotice>
      ) : null}
      <InkButton
        variant="primary"
        icon="lock"
        block
        disabled={vm.problem !== null || vm.unlocking || cooling}
        onPress={() => void submit()}
      >
        {vm.unlocking ? t('myPond.lock.unlocking') : t('myPond.lock.unlock')}
      </InkButton>
    </View>
  );
}

/** Everything My Pond shows while it is not open. `onRetry` reads the status again. */
export function AdminLockView({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const { gate } = useAdminGate();
  const mono = inkText(theme, { role: 'mono', size: 'sm', color: theme.color.text }).style;

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
          <View style={styles.card}>
            <InkText size="md">{t('myPond.lock.noCard')}</InkText>
            <InkText size="sm" style={{ color: theme.color.textSecondary }}>
              {t('myPond.lock.noCardHow')}
            </InkText>
            <Text selectable style={[mono, styles.command, { backgroundColor: theme.color.bg, borderRadius: theme.radius.sm }]}>
              {ADMIN_CARD_COMMAND}
            </Text>
          </View>
        </SettingsGroup>
      );
    case 'locked':
      return <LockForm />;
  }
}

const styles = StyleSheet.create({
  form: { gap: Spacing.md, marginBottom: Spacing.xl },
  intro: { gap: Spacing.sm, marginBottom: Spacing.sm },
  frame: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  // Copied off a printed card group by group, so every character keeps a fixed-width column.
  code: { flex: 1, fontFamily: FontFamily.mono, letterSpacing: 1 },
  centre: { alignItems: 'center', paddingVertical: Spacing['2xl'] },
  card: { gap: Spacing.sm, padding: Spacing.lg },
  command: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, overflow: 'hidden' },
});
