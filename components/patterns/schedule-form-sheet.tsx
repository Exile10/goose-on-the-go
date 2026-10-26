/**
 * ScheduleFormSheet — a new schedule, or an edit to one, that runs a prompt.
 *
 * "Once" is a date and a time; "On repeat" is a cron expression, written by
 * hand for now. What each becomes on the wire, and which fields an edit
 * sends, is `createRequest` and `updateRequest` in `models/schedule.ts`.
 * Checks that would otherwise come back as a 400 run there first, so the
 * person hears what to fix before anything is sent.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  InkButton,
  InkDatePicker,
  InkFormField,
  InkInput,
  InkNotice,
  InkSegmented,
  InkSheet,
  InkText,
  InkTextArea,
  InkTimePicker,
} from '@jarida/ink/native';
import type { CivilDate } from '@jarida/ink';

import {
  createRequest,
  deviceTimeZone,
  draftFrom,
  emptyDraft,
  promptOf,
  updateRequest,
  type ScheduleDraft,
} from '@/models/schedule';
import { confirm, reject } from '@/services/haptics';
import type { CreateScheduleRequest, Schedule, UpdateScheduleRequest } from '@/services/types';

export type ScheduleFormSheetProps = {
  open: boolean;
  onClose: () => void;
} & (
  | {
      /** Resolves to why it was refused, or null once it exists. */
      onCreate: (req: CreateScheduleRequest) => Promise<string | null>;
      schedule?: undefined;
    }
  | {
      /** The schedule being edited, as the Pond has it; the form opens with its values. */
      schedule: Schedule;
      /** Resolves to why it was refused, or null once saved. */
      onUpdate: (req: UpdateScheduleRequest) => Promise<string | null>;
    }
);

function todayCivil(): CivilDate {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export function ScheduleFormSheet(props: ScheduleFormSheetProps) {
  const { open, onClose } = props;
  const editing = props.schedule;
  const { t } = useTranslation();
  const [phoneZone] = useState(deviceTimeZone);
  const [draft, setDraft] = useState<ScheduleDraft>(() => (editing ? draftFrom(editing) : emptyDraft(phoneZone)));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // An edit opens on the schedule as it is now. Only on opening: the detail
  // screen re-reads the schedule while it is up, and that must not wipe what
  // is being typed.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && editing) {
      setDraft(draftFrom(editing));
      setError(null);
    }
  }

  const set =
    <K extends keyof ScheduleDraft>(key: K) =>
    (value: ScheduleDraft[K]) =>
      setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    let refused: string | null;
    if (props.schedule) {
      const built = updateRequest(props.schedule, draft);
      if (!built.ok) return refuse(t(built.error));
      setError(null);
      setSubmitting(true);
      refused = await props.onUpdate(built.req);
    } else {
      const built = createRequest(draft);
      if (!built.ok) return refuse(t(built.error));
      setError(null);
      setSubmitting(true);
      refused = await props.onCreate(built.req);
    }
    setSubmitting(false);
    if (refused) return refuse(refused);
    void confirm();
    // Only a created schedule clears the form. A stray tap on the backdrop
    // closes the sheet too, and it should not cost the draft.
    if (!editing) setDraft(emptyDraft(phoneZone));
    onClose();
  };

  const refuse = (sentence: string) => {
    void reject();
    setError(sentence);
  };

  // Without `today` the calendar opens on its own default month, January 2026.
  const today = todayCivil();
  // A webhook has no prompt to edit; see `updateRequest`.
  const hasPrompt = !editing || promptOf(editing) != null;
  // The zone is offered only where there is a choice: the schedule's own, or this phone's.
  const zones = editing && editing.timezone !== phoneZone ? [editing.timezone, phoneZone] : null;

  return (
    <InkSheet
      open={open}
      onClose={onClose}
      title={editing ? t('schedule.form.editScheduleTitle') : t('schedule.form.scheduleTitle')}
    >
      <InkFormField label={t('schedule.form.name')}>
        <InkInput
          label={t('schedule.form.name')}
          placeholder={t('schedule.form.schedulePlaceholder')}
          value={draft.name}
          onChange={set('name')}
        />
      </InkFormField>

      <InkFormField label={t('schedule.form.timing')}>
        <InkSegmented
          label={t('schedule.form.timing')}
          value={draft.timing}
          options={[
            { value: 'once', label: t('schedule.form.once') },
            { value: 'repeat', label: t('schedule.form.repeat') },
          ]}
          onChange={set('timing')}
        />
      </InkFormField>

      {draft.timing === 'once' ? (
        <>
          <InkFormField label={t('schedule.form.date')}>
            <InkDatePicker
              label={t('schedule.form.date')}
              placeholder={t('schedule.form.datePlaceholder')}
              value={draft.date}
              onChange={set('date')}
              today={today}
              min={today}
            />
          </InkFormField>
          <InkFormField label={t('schedule.form.time')}>
            <InkTimePicker label={t('schedule.form.time')} value={draft.time} onChange={set('time')} />
          </InkFormField>
        </>
      ) : (
        <>
          <InkFormField label={t('schedule.form.cron')}>
            <InkInput
              label={t('schedule.form.cron')}
              placeholder="0 0 9 * * 1-5"
              value={draft.cron}
              onChange={set('cron')}
            />
          </InkFormField>
          <InkText size="sm" tone="tertiary">{t('schedule.form.cronHint')}</InkText>
        </>
      )}

      {zones ? (
        <InkFormField label={t('schedule.form.timezone')}>
          <InkSegmented
            label={t('schedule.form.timezone')}
            value={draft.timezone}
            options={zones.map((zone) => ({ value: zone, label: zone }))}
            onChange={set('timezone')}
          />
        </InkFormField>
      ) : null}
      <InkText size="sm" tone="tertiary">{t('schedule.form.phoneZone', { zone: phoneZone })}</InkText>

      {hasPrompt ? (
        <InkFormField label={t('schedule.form.prompt')}>
          <InkTextArea
            label={t('schedule.form.prompt')}
            placeholder={t('schedule.form.promptPlaceholder')}
            value={draft.prompt}
            onChange={set('prompt')}
            rows={3}
            maxRows={6}
          />
        </InkFormField>
      ) : (
        <InkText size="sm" tone="secondary">{t('schedule.detail.webhookNote')}</InkText>
      )}

      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}

      <InkButton variant="primary" block disabled={submitting} onPress={submit}>
        {editing ? t('schedule.form.save') : t('schedule.form.create')}
      </InkButton>
    </InkSheet>
  );
}
