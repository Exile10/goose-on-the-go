/**
 * What every setup step shares: the way on and back, the line saying whether Goose is warmed up,
 * and a checkbox row, since a choice saved with the step is a checkbox and not a switch.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCheckbox, InkDots, InkRow, InkText } from '@jarida/ink/native';

import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { isRequired } from '@/models/owner-setup';
import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import { toggle } from '@/services/haptics';
import type { TranslationKey } from '@/services/i18n';
import type { WarmupStatus } from '@/services/types';
import { useLive } from '@/view-models/use-live';
import type { UseOwnerSetup } from '@/view-models/use-owner-setup';

export function SetupFooter({ setup }: { setup: UseOwnerSetup }) {
  const { t } = useTranslation();
  const { step, index, saving, canContinue, actions } = setup;
  // How Goose talks is the last thing asked; the model step finishes by itself once a model is in place.
  const finishing = step === 'personality';
  if (step === 'model') {
    return (
      <View style={styles.actions}>
        <InkButton variant="quiet" icon="chevron-left" disabled={saving} onPress={actions.back}>
          {t('setup.back')}
        </InkButton>
      </View>
    );
  }
  return (
    <View style={styles.actions}>
      {index > 0 ? (
        <InkButton variant="quiet" icon="chevron-left" disabled={saving} onPress={actions.back}>
          {t('setup.back')}
        </InkButton>
      ) : (
        <View />
      )}
      <View style={styles.forward}>
        {!isRequired(step) ? (
          <InkButton variant="quiet" disabled={saving} onPress={() => void actions.skip()}>
            {t('setup.skip')}
          </InkButton>
        ) : null}
        <InkButton
          variant="primary"
          disabled={saving || !canContinue}
          onPress={() => void (finishing ? actions.finish() : actions.next())}
        >
          {finishing ? t('setup.finish') : t('setup.continue')}
        </InkButton>
      </View>
    </View>
  );
}

function warmupKey(status: WarmupStatus | null): TranslationKey | null {
  switch (status?.state) {
    case 'warming':
      return 'setup.warmup.warming';
    case 'ready':
      return 'setup.warmup.ready';
    case 'skipped':
      return 'setup.warmup.waiting';
    case 'failed':
      return 'setup.warmup.failed';
    default:
      return null;
  }
}

const WARMUP_MS = 5_000;

/** `/warmup` answers anyone until setup is done; read while the wizard is open. */
export function SetupWarmup() {
  const { t } = useTranslation();
  const { hydrated } = useServer();
  const [status, setStatus] = useState<WarmupStatus | null>(null);
  const read = useCallback(async () => {
    try {
      setStatus(await api.warmup());
    } catch {
      // Keep the last answer; the line is a courtesy, not a gate.
    }
  }, []);
  useLive(read, WARMUP_MS, hydrated);
  const key = warmupKey(status);
  if (!key) return null;
  return (
    <View style={styles.warmup} accessibilityLiveRegion="polite">
      {status?.state === 'warming' ? <InkDots label={t(key)} /> : null}
      <InkText size="sm" tone="tertiary">
        {t(key)}
      </InkText>
    </View>
  );
}

export function CheckRow({
  label,
  description,
  checked,
  onChange,
  divided,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  divided?: boolean;
}) {
  const flip = () => {
    void toggle();
    onChange(!checked);
  };
  return (
    <GPressable onPress={flip} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}>
      <InkRow divided={divided} label={label} description={description}>
        <InkCheckbox checked={checked} onChange={flip} label={label} />
      </InkRow>
    </GPressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  forward: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  warmup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
