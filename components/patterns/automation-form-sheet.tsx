/**
 * AutomationFormSheet — a new sensor-triggered rule, or an edit to one.
 *
 * The Pond takes several actions per rule; one is what this form offers, which
 * covers "when X, do Y" and keeps the form one screen long. An edit to a rule
 * with more changes its first action and sends the rest back as they were,
 * since `PUT /rules/{id}` replaces the whole rule and a field left out is a
 * field lost. The checks the Pond would answer with a 400 (no action, a
 * condition with an operator but no value, a time bound that is not HH:MM)
 * run here first.
 *
 * The form only exists while the sheet is open, so the device list it reads
 * is not polled behind a closed sheet, closing it clears what was typed, and
 * an edit opens on the rule as it is now.
 */

import React, { useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  InkButton,
  InkFormField,
  InkInput,
  InkNotice,
  InkRadioGroup,
  InkSegmented,
  InkSelect,
  InkSheet,
  InkText,
  InkTextArea,
  type InkRadioOption,
} from '@jarida/ink/native';

import { sourceKey } from '@/components/patterns/automation-card';
import { GKeyboardView } from '@/components/ui/g-keyboard-view';
import { confirm, reject } from '@/services/haptics';
import type { Rule, RuleRequest, TriggerAction, TriggerCondition, TriggerSource } from '@/services/types';
import { supports, useDevices } from '@/view-models/use-devices';
import { Spacing } from '@/constants/spacing';

type Op = NonNullable<TriggerCondition['op']>;

export interface AutomationFormSheetProps {
  open: boolean;
  onClose: () => void;
  /** The rule being edited, or absent for a new one. */
  rule?: Rule;
  /** Resolves to why it was refused, or null once it is saved: created, or the edit stored. */
  onSubmit: (req: RuleRequest) => Promise<string | null>;
  /** Only for an edit. Resolves to why it was refused, or null once it is gone. */
  onDelete?: () => Promise<string | null>;
}

/** "HH:MM", 24-hour, as the Pond parses a time bound. */
const TIME_BOUND = /^([01]\d|2[0-3]):[0-5]\d$/;

export function AutomationFormSheet({ open, onClose, rule, onSubmit, onDelete }: AutomationFormSheetProps) {
  const { t } = useTranslation();
  return (
    <InkSheet
      open={open}
      onClose={onClose}
      title={rule ? t('schedule.form.editAutomationTitle') : t('schedule.form.automationTitle')}
    >
      {open ? <AutomationForm onClose={onClose} rule={rule} onSubmit={onSubmit} onDelete={onDelete} /> : null}
    </InkSheet>
  );
}

const SOURCES: TriggerSource['kind'][] = ['sensor', 'camera', 'device'];

/**
 * A device choice that scrolls in place. `InkSelect` lists its options in a
 * sheet that does not scroll, so with a dozen devices the first of them, and
 * "Any device" with them, ran off the top of the screen.
 */
function DeviceList({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: InkRadioOption<string>[];
  onChange: (id: string) => void;
}) {
  const { height } = useWindowDimensions();
  return (
    <InkFormField label={label}>
      <ScrollView style={{ maxHeight: height * 0.3 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        <InkRadioGroup label={label} value={value} options={options} onChange={onChange} />
      </ScrollView>
    </InkFormField>
  );
}

function AutomationForm({ onClose, rule, onSubmit, onDelete }: Omit<AutomationFormSheetProps, 'open'>) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const { data } = useDevices();
  const switchable = data.devices.filter((d) => supports(d, 'power'));
  const first = rule?.actions[0];
  // Kept as they are; see the file comment.
  const rest = rule?.actions.slice(1) ?? [];

  const [name, setName] = useState(rule?.name ?? '');
  const [sourceKind, setSourceKind] = useState<TriggerSource['kind']>(rule?.source.kind ?? 'sensor');
  // '' is "any": the Pond matches every device or signal when the field is left out.
  const [deviceId, setDeviceId] = useState(rule?.source.device_id ?? '');
  const [signal, setSignal] = useState(rule?.source.signal ?? '');
  const [op, setOp] = useState<Op | ''>(rule?.condition?.op ?? '');
  const [value, setValue] = useState(rule?.condition?.value != null ? String(rule.condition.value) : '');
  const [after, setAfter] = useState(rule?.condition?.after ?? '');
  const [before, setBefore] = useState(rule?.condition?.before ?? '');
  const [cooldown, setCooldown] = useState(String(rule?.cooldown_secs ?? 60));
  const [actionType, setActionType] = useState<TriggerAction['type']>(first?.type ?? 'agent_prompt');
  const [prompt, setPrompt] = useState(first?.type === 'agent_prompt' ? first.prompt : '');
  const [targetId, setTargetId] = useState(first?.type === 'device_power' ? first.device_id : '');
  const [turnOn, setTurnOn] = useState<'on' | 'off'>(first?.type === 'device_power' && !first.on ? 'off' : 'on');
  const [notifyTitle, setNotifyTitle] = useState(first?.type === 'notify' ? first.title : '');
  const [notifyBody, setNotifyBody] = useState(first?.type === 'notify' ? first.body : '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const action = (): TriggerAction | null => {
    switch (actionType) {
      case 'agent_prompt':
        return prompt.trim() ? { type: 'agent_prompt', prompt: prompt.trim() } : null;
      case 'device_power':
        return targetId ? { type: 'device_power', device_id: targetId, on: turnOn === 'on' } : null;
      case 'notify':
        return notifyTitle.trim() ? { type: 'notify', title: notifyTitle.trim(), body: notifyBody.trim() } : null;
    }
  };

  /** The request, or the sentence that says what is missing. */
  const build = (): RuleRequest | string => {
    if (!name.trim()) return t('schedule.errors.nameRequired');
    // Many locales type a decimal comma, and `Number('21,5')` is NaN.
    const reading = Number(value.trim().replace(',', '.'));
    if (op && (!value.trim() || !Number.isFinite(reading))) return t('schedule.errors.valueRequired');
    const wait = Number(cooldown);
    if (!/^\d+$/.test(cooldown.trim()) || !Number.isFinite(wait)) return t('schedule.errors.cooldownInvalid');
    if ([after, before].some((b) => b.trim() && !TIME_BOUND.test(b.trim()))) return t('schedule.errors.timeBound');
    const act = action();
    if (!act) return t('schedule.errors.actionIncomplete');
    const condition: TriggerCondition = {
      ...(op ? { op, value: reading } : {}),
      ...(after.trim() ? { after: after.trim() } : {}),
      ...(before.trim() ? { before: before.trim() } : {}),
    };
    return {
      name: name.trim(),
      source: {
        kind: sourceKind,
        ...(deviceId ? { device_id: deviceId } : {}),
        ...(signal.trim() ? { signal: signal.trim() } : {}),
      },
      ...(Object.keys(condition).length > 0 ? { condition } : {}),
      actions: [act, ...rest],
      cooldown_secs: wait,
    };
  };

  const submit = async () => {
    const req = build();
    if (typeof req === 'string') {
      void reject();
      setError(req);
      return;
    }
    setError(null);
    setSubmitting(true);
    const refused = await onSubmit(req);
    setSubmitting(false);
    if (refused) {
      void reject();
      setError(refused);
      return;
    }
    void confirm();
    onClose();
  };

  const confirmDelete = () => {
    if (!rule || !onDelete) return;
    Alert.alert(t('schedule.list.deleteAutomationTitle'), t('schedule.list.deleteAutomationBody', { name: rule.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('schedule.form.delete'),
        style: 'destructive',
        onPress: () => {
          void onDelete().then((refused) => {
            if (refused) {
              void reject();
              setError(refused);
              return;
            }
            void confirm();
            onClose();
          });
        },
      },
    ]);
  };

  const devices = [
    { value: '', label: t('schedule.form.anyDevice') },
    ...data.devices.map((d) => ({ value: d.id, label: d.name })),
  ];

  return (
    // Bounded as the schedule sheet is, keyboard included; see there.
    <GKeyboardView style={{ maxHeight: height * 0.7 }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <InkFormField label={t('schedule.form.name')}>
          <InkInput
            label={t('schedule.form.name')}
            placeholder={t('schedule.form.automationPlaceholder')}
            value={name}
            onChange={setName}
          />
        </InkFormField>

        <InkFormField label={t('schedule.form.source')}>
          <InkSegmented
            label={t('schedule.form.source')}
            value={sourceKind}
            options={SOURCES.map((kind) => ({ value: kind, label: t(sourceKey(kind)) }))}
            onChange={setSourceKind}
          />
        </InkFormField>

        <DeviceList label={t('schedule.form.device')} value={deviceId} options={devices} onChange={setDeviceId} />

        <InkFormField label={t('schedule.form.signal')}>
          <InkInput
            label={t('schedule.form.signal')}
            placeholder={t('schedule.form.signalPlaceholder')}
            value={signal}
            onChange={setSignal}
          />
        </InkFormField>

        <InkFormField label={t('schedule.form.condition')}>
          <InkSelect<Op | ''>
            label={t('schedule.form.condition')}
            value={op}
            options={[
              { value: '', label: t('schedule.form.noCondition') },
              { value: 'gt', label: t('schedule.form.opGt') },
              { value: 'gte', label: t('schedule.form.opGte') },
              { value: 'lt', label: t('schedule.form.opLt') },
              { value: 'lte', label: t('schedule.form.opLte') },
              { value: 'eq', label: t('schedule.form.opEq') },
            ]}
            onChange={setOp}
          />
        </InkFormField>
        {op ? (
          <InkFormField label={t('schedule.form.value')}>
            {/* iOS's numeric keyboard is a decimal pad with no minus key, and a
                threshold can be below zero. Android's numeric keyboard has one. */}
            <InkInput
              label={t('schedule.form.value')}
              type={Platform.OS === 'ios' ? 'text' : 'number'}
              value={value}
              onChange={setValue}
            />
          </InkFormField>
        ) : null}

        <InkFormField label={t('schedule.form.after')}>
          <InkInput label={t('schedule.form.after')} placeholder="18:30" value={after} onChange={setAfter} />
        </InkFormField>
        <InkFormField label={t('schedule.form.before')}>
          <InkInput label={t('schedule.form.before')} placeholder="06:00" value={before} onChange={setBefore} />
        </InkFormField>
        <InkText size="sm" tone="tertiary">{t('schedule.form.timeBoundHint')}</InkText>

        <InkFormField label={t('schedule.form.cooldown')}>
          <InkInput label={t('schedule.form.cooldown')} type="number" value={cooldown} onChange={setCooldown} />
        </InkFormField>

        <InkFormField label={t('schedule.form.action')}>
          <InkRadioGroup<TriggerAction['type']>
            label={t('schedule.form.action')}
            value={actionType}
            options={[
              { value: 'agent_prompt', label: t('schedule.form.actionPrompt') },
              { value: 'device_power', label: t('schedule.form.actionPower') },
              { value: 'notify', label: t('schedule.form.actionNotify') },
            ]}
            onChange={setActionType}
          />
        </InkFormField>

        {actionType === 'agent_prompt' ? (
          <InkFormField label={t('schedule.form.prompt')}>
            <InkTextArea
              label={t('schedule.form.prompt')}
              placeholder={t('schedule.form.promptPlaceholder')}
              value={prompt}
              onChange={setPrompt}
              rows={3}
              maxRows={6}
            />
          </InkFormField>
        ) : null}

        {actionType === 'device_power' ? (
          <>
            {/* Nothing is chosen until a device is pressed; the list needs no placeholder row. */}
            <DeviceList
              label={t('schedule.form.targetDevice')}
              value={targetId}
              options={switchable.map((d) => ({ value: d.id, label: d.name }))}
              onChange={setTargetId}
            />
            <InkFormField label={t('schedule.form.power')}>
              <InkSegmented
                label={t('schedule.form.power')}
                value={turnOn}
                options={[
                  { value: 'on', label: t('schedule.form.turnOn') },
                  { value: 'off', label: t('schedule.form.turnOff') },
                ]}
                onChange={setTurnOn}
              />
            </InkFormField>
          </>
        ) : null}

        {actionType === 'notify' ? (
          <>
            <InkFormField label={t('schedule.form.notifyTitle')}>
              <InkInput label={t('schedule.form.notifyTitle')} value={notifyTitle} onChange={setNotifyTitle} />
            </InkFormField>
            <InkFormField label={t('schedule.form.notifyBody')}>
              <InkInput label={t('schedule.form.notifyBody')} value={notifyBody} onChange={setNotifyBody} />
            </InkFormField>
          </>
        ) : null}

        {rest.length > 0 ? (
          <InkText size="sm" tone="tertiary">{t('schedule.form.moreActions', { count: rest.length })}</InkText>
        ) : null}

        {error ? <InkNotice tone="danger">{error}</InkNotice> : null}

        <InkButton variant="primary" block disabled={submitting} onPress={submit}>
          {rule ? t('schedule.form.save') : t('schedule.form.create')}
        </InkButton>
        {rule && onDelete ? (
          <InkButton variant="danger" block icon="delete" disabled={submitting} onPress={confirmDelete}>
            {t('schedule.form.delete')}
          </InkButton>
        ) : null}
      </ScrollView>
    </GKeyboardView>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.lg, paddingBottom: Spacing['2xl'] },
});
