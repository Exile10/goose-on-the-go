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
 * A rule that listens to a camera is the same form with three things changed: what it listens
 * for is chosen from the signals the Pond can match, one per household member by name, instead
 * of typed; the confidence it compares is named for what it measures; and it is entered as a
 * percent, since the Pond compares a fraction nobody types.
 *
 * The form only exists while the sheet is open, so the device list it reads
 * is not polled behind a closed sheet, closing it clears what was typed, and
 * an edit opens on the rule as it is now.
 */

import React, { useState } from 'react';
import { Platform, ScrollView, useWindowDimensions } from 'react-native';
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
import { describeSignal, fractionFromPercent, measureOfSignal, percentText, type Measure } from '@/models/vision';
import { useConfirm } from '@/providers/confirm-provider';
import { confirm, reject } from '@/services/haptics';
import type { TranslationKey } from '@/services/i18n';
import type { Rule, RuleRequest, TriggerAction, TriggerCondition, TriggerSource } from '@/services/types';
import { supports, useDevices } from '@/view-models/use-devices';
import { useVisionSignals } from '@/view-models/use-vision-signals';

type Op = NonNullable<TriggerCondition['op']>;

export interface AutomationFormSheetProps {
  open: boolean;
  onClose: () => void;
  /** The rule being edited, or absent for a new one. */
  rule?: Rule;
  /** What a new rule starts as, such as one made from an event. Ignored for an edit. */
  prefill?: RuleRequest;
  /** Resolves to why it was refused, or null once it is saved: created, or the edit stored. */
  onSubmit: (req: RuleRequest) => Promise<string | null>;
  /** Only for an edit. Resolves to why it was refused, or null once it is gone. */
  onDelete?: () => Promise<string | null>;
}

/** "HH:MM", 24-hour, as the Pond parses a time bound. */
const TIME_BOUND = /^([01]\d|2[0-3]):[0-5]\d$/;

export function AutomationFormSheet({ open, onClose, rule, prefill, onSubmit, onDelete }: AutomationFormSheetProps) {
  const { t } = useTranslation();
  return (
    <InkSheet
      open={open}
      onClose={onClose}
      title={rule ? t('schedule.form.editAutomationTitle') : t('schedule.form.automationTitle')}
    >
      {open ? <AutomationForm onClose={onClose} rule={rule} prefill={prefill} onSubmit={onSubmit} onDelete={onDelete} /> : null}
    </InkSheet>
  );
}

const SOURCES: TriggerSource['kind'][] = ['sensor', 'camera', 'device'];

/**
 * A choice that scrolls in place. `InkSelect` lists its options in a
 * sheet that does not scroll, so with a dozen devices the first of them, and
 * "Any device" with them, ran off the top of the screen.
 */
function ChoiceList({
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

/** What the confidence a camera rule compares is called, by what it measures. */
function conditionLabel(measure: Measure): TranslationKey {
  switch (measure) {
    case 'sure':
      return 'visionAutomations.form.conditionDetector';
    case 'match':
      return 'visionAutomations.form.conditionFace';
    case 'change':
      return 'visionAutomations.form.conditionChange';
  }
}

/** What a camera rule listens for: a signal chosen by name, and the camera when there are several. */
function CameraFields({
  signal,
  onSignal,
  cameraId,
  onCamera,
}: {
  signal: string;
  onSignal: (signal: string) => void;
  cameraId: string;
  onCamera: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { options, cameras, nameOf } = useVisionSignals();
  // A signal this build has no name for, from an older rule, stays on screen rather than vanish.
  const all = options.some((o) => o.value === signal) ? options : [...options, { value: signal, label: signal, hint: null }];
  const camerasToChoose = [...new Set([...cameras, ...(cameraId ? [cameraId] : [])])];

  return (
    <>
      <ChoiceList
        label={t('visionAutomations.form.signal')}
        value={signal}
        options={all.map((o) => ({ value: o.value, label: o.label, description: o.hint ?? undefined }))}
        onChange={onSignal}
      />
      {/* The list scrolls, so the choice may be out of sight: say it. */}
      <InkText size="sm" tone="secondary">
        {t('visionAutomations.form.fires', { subject: describeSignal(signal, nameOf) })}
      </InkText>
      {camerasToChoose.length > 1 ? (
        <ChoiceList
          label={t('visionAutomations.form.camera')}
          value={cameraId}
          options={[
            { value: '', label: t('visionAutomations.form.anyCamera') },
            ...camerasToChoose.map((id) => ({ value: id, label: id })),
          ]}
          onChange={onCamera}
        />
      ) : null}
    </>
  );
}

export function AutomationForm({ onClose, rule, prefill, onSubmit, onDelete }: Omit<AutomationFormSheetProps, 'open'>) {
  const { t } = useTranslation();
  const ask = useConfirm();
  const { data } = useDevices();
  const switchable = data.devices.filter((d) => supports(d, 'power'));
  // An edit opens on the rule; a new one on what it was prefilled with, or on nothing.
  const base = rule ?? prefill;
  const first = base?.actions[0];
  // Kept as they are; see the file comment.
  const rest = rule?.actions.slice(1) ?? [];
  const startsOnCamera = base?.source.kind === 'camera';

  const [name, setName] = useState(base?.name ?? '');
  const [sourceKind, setSourceKind] = useState<TriggerSource['kind']>(base?.source.kind ?? 'sensor');
  // '' is "any": the Pond matches every device or signal when the field is left out.
  const [deviceId, setDeviceId] = useState(base?.source.device_id ?? '');
  const [signal, setSignal] = useState(base?.source.signal ?? '');
  const [op, setOp] = useState<Op | ''>(base?.condition?.op ?? '');
  const [value, setValue] = useState(
    base?.condition?.value != null ? (startsOnCamera ? percentText(base.condition.value) : String(base.condition.value)) : '',
  );
  const [after, setAfter] = useState(base?.condition?.after ?? '');
  const [before, setBefore] = useState(base?.condition?.before ?? '');
  const [cooldown, setCooldown] = useState(String(base?.cooldown_secs ?? 60));
  const [actionType, setActionType] = useState<TriggerAction['type']>(first?.type ?? 'agent_prompt');
  const [prompt, setPrompt] = useState(first?.type === 'agent_prompt' ? first.prompt : '');
  const [targetId, setTargetId] = useState(first?.type === 'device_power' ? first.device_id : '');
  const [turnOn, setTurnOn] = useState<'on' | 'off'>(first?.type === 'device_power' && !first.on ? 'off' : 'on');
  const [notifyTitle, setNotifyTitle] = useState(first?.type === 'notify' ? first.title : '');
  const [notifyBody, setNotifyBody] = useState(first?.type === 'notify' ? first.body : '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isCamera = sourceKind === 'camera';
  const measure = measureOfSignal(signal);

  /** What a signal, a device and a reading mean depends on the kind, so a new kind starts clean. */
  const changeKind = (kind: TriggerSource['kind']) => {
    if (kind === sourceKind) return;
    setSourceKind(kind);
    setDeviceId('');
    setSignal('');
    setOp('');
    setValue('');
  };

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
    const typed = Number(value.trim().replace(',', '.'));
    if (op && (!value.trim() || !Number.isFinite(typed))) return t('schedule.errors.valueRequired');
    const reading = isCamera ? fractionFromPercent(typed) : typed;
    if (op && reading === null) return t('visionAutomations.errors.percent');
    const wait = Number(cooldown);
    if (!/^\d+$/.test(cooldown.trim()) || !Number.isFinite(wait)) return t('schedule.errors.cooldownInvalid');
    if ([after, before].some((b) => b.trim() && !TIME_BOUND.test(b.trim()))) return t('schedule.errors.timeBound');
    const act = action();
    if (!act) return t('schedule.errors.actionIncomplete');
    const condition: TriggerCondition = {
      ...(op && reading !== null ? { op, value: reading } : {}),
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
    void ask({
      title: t('schedule.list.deleteAutomationTitle'),
      message: t('schedule.list.deleteAutomationBody', { name: rule.name }),
      confirmLabel: t('schedule.form.delete'),
      destructive: true,
    }).then(async (yes) => {
      if (!yes) return;
      const refused = await onDelete();
      if (refused) {
        void reject();
        setError(refused);
        return;
      }
      void confirm();
      onClose();
    });
  };

  const devices = [
    { value: '', label: t('schedule.form.anyDevice') },
    ...data.devices.map((d) => ({ value: d.id, label: d.name })),
  ];

  // A rule that already compares "Exactly" keeps it; nobody is offered it for a confidence.
  const cameraOps: { value: Op | ''; label: string }[] = [
    { value: '', label: t('visionAutomations.form.anySure') },
    { value: 'gte', label: t('schedule.form.opGte') },
    { value: 'gt', label: t('schedule.form.opGt') },
    { value: 'lte', label: t('schedule.form.opLte') },
    { value: 'lt', label: t('schedule.form.opLt') },
    ...(op === 'eq' ? [{ value: 'eq' as const, label: t('schedule.form.opEq') }] : []),
  ];
  const sensorOps: { value: Op | ''; label: string }[] = [
    { value: '', label: t('schedule.form.noCondition') },
    { value: 'gt', label: t('schedule.form.opGt') },
    { value: 'gte', label: t('schedule.form.opGte') },
    { value: 'lt', label: t('schedule.form.opLt') },
    { value: 'lte', label: t('schedule.form.opLte') },
    { value: 'eq', label: t('schedule.form.opEq') },
  ];

  return (
    <>
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
          onChange={changeKind}
        />
      </InkFormField>

      {isCamera ? (
        <CameraFields signal={signal} onSignal={setSignal} cameraId={deviceId} onCamera={setDeviceId} />
      ) : (
        <>
          <ChoiceList label={t('schedule.form.device')} value={deviceId} options={devices} onChange={setDeviceId} />

          <InkFormField label={t('schedule.form.signal')}>
            <InkInput
              label={t('schedule.form.signal')}
              placeholder={t('schedule.form.signalPlaceholder')}
              value={signal}
              onChange={setSignal}
            />
          </InkFormField>
        </>
      )}

      <InkFormField label={isCamera ? t(conditionLabel(measure)) : t('schedule.form.condition')}>
        <InkSelect<Op | ''>
          label={isCamera ? t(conditionLabel(measure)) : t('schedule.form.condition')}
          value={op}
          options={isCamera ? cameraOps : sensorOps}
          onChange={setOp}
        />
      </InkFormField>
      {op ? (
        <InkFormField label={isCamera ? t('visionAutomations.form.percent') : t('schedule.form.value')}>
          {/* iOS's numeric keyboard is a decimal pad with no minus key, and a
              threshold can be below zero. Android's numeric keyboard has one. A percent
              is never below zero, so a camera's takes the number pad. */}
          <InkInput
            label={isCamera ? t('visionAutomations.form.percent') : t('schedule.form.value')}
            type={Platform.OS === 'ios' && !isCamera ? 'text' : 'number'}
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
          <ChoiceList
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

      <InkButton variant="primary" block loading={submitting} onPress={submit}>
        {rule ? t('schedule.form.save') : t('schedule.form.create')}
      </InkButton>
      {rule && onDelete ? (
        <InkButton variant="danger" block icon="trash" disabled={submitting} onPress={confirmDelete}>
          {t('schedule.form.delete')}
        </InkButton>
      ) : null}
    </>
  );
}
