/**
 * ScheduleFormSheet — a new schedule, or an edit to one, that runs a prompt.
 *
 * "Once" is a date and a time. The repeats are the dashboard's: hourly, daily,
 * weekly on chosen days, monthly on a day, or a custom cron typed by hand;
 * each preset writes the cron the dashboard would. A line under them says in
 * words when it will run. What each becomes on the wire, and which fields an
 * edit sends, is `createRequest` and `updateRequest` in `models/schedule.ts`.
 * Checks that would otherwise come back as a 400 run there first, so the
 * person hears what to fix before anything is sent.
 */

import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  InkButton,
  InkChip,
  InkDatePicker,
  InkFormField,
  InkInput,
  InkNotice,
  InkNumberField,
  InkSegmented,
  InkSheet,
  InkText,
  InkTextArea,
  InkTimePicker,
} from '@jarida/ink/native';
import type { CivilDate } from '@jarida/ink';

import { GSheetBody } from '@/components/ui/g-sheet-body';
import {
  CRON_WEEKDAYS,
  TIMINGS,
  createRequest,
  describeCron,
  deviceTimeZone,
  draftCron,
  draftFrom,
  emptyDraft,
  promptOf,
  updateRequest,
  weekdayShortName,
  type ScheduleDraft,
  type Timing,
} from '@/models/schedule';
import { confirm, reject } from '@/services/haptics';
import type { CreateScheduleRequest, Schedule, UpdateScheduleRequest } from '@/services/types';
import { Spacing } from '@/constants/spacing';

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

/** Each timing's name; spelled out so every key is a literal the catalogue checks. */
function timingLabel(timing: Timing, t: TFunction): string {
  switch (timing) {
    case 'once':
      return t('schedule.form.once');
    case 'hourly':
      return t('schedule.form.hourly');
    case 'daily':
      return t('schedule.form.daily');
    case 'weekly':
      return t('schedule.form.weekly');
    case 'monthly':
      return t('schedule.form.monthly');
    case 'custom':
      return t('schedule.form.custom');
  }
}

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

  // Custom opens on the cron the chosen preset would send, to adjust rather than retype.
  const chooseTiming = (timing: Timing) =>
    setDraft((d) => {
      const current = d.timing === 'once' ? null : draftCron(d);
      return { ...d, timing, cron: timing === 'custom' && current ? current : d.cron };
    });

  // Like the dashboard, the last day stays chosen: a week with no days never runs.
  const toggleDay = (day: number) =>
    setDraft((d) => {
      const next = d.weekdays.includes(day) ? d.weekdays.filter((x) => x !== day) : [...d.weekdays, day];
      return next.length ? { ...d, weekdays: next } : d;
    });

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
  // When it will run, in words, as the dashboard previews it. Nothing until the
  // fields are complete; a cron the words cannot read is pointed back at.
  const cron = draftCron(draft);
  const words = cron ? describeCron(cron) : null;
  const preview = !cron
    ? null
    : words
      ? t('schedule.form.preview', { when: words, zone: draft.timezone })
      : t('schedule.form.previewCron', { zone: draft.timezone });
  const timeField = (
    <InkFormField label={t('schedule.form.time')}>
      <InkTimePicker label={t('schedule.form.time')} value={draft.time} onChange={set('time')} />
    </InkFormField>
  );

  return (
    <InkSheet
      open={open}
      onClose={onClose}
      title={editing ? t('schedule.form.editScheduleTitle') : t('schedule.form.scheduleTitle')}
    >
      <GSheetBody>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <InkFormField label={t('schedule.form.name')}>
            <InkInput
              label={t('schedule.form.name')}
              placeholder={t('schedule.form.schedulePlaceholder')}
              value={draft.name}
              onChange={set('name')}
            />
          </InkFormField>

          <InkFormField label={t('schedule.form.timing')}>
            <View style={styles.chips}>
              {TIMINGS.map((timing) => (
                <InkChip key={timing} selected={draft.timing === timing} onPress={() => chooseTiming(timing)}>
                  {timingLabel(timing, t)}
                </InkChip>
              ))}
            </View>
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
              {timeField}
            </>
          ) : null}

          {draft.timing === 'hourly' ? (
            <>
              <InkFormField label={t('schedule.form.everyHours')}>
                <InkNumberField
                  label={t('schedule.form.everyHours')}
                  value={draft.everyHours}
                  onChange={set('everyHours')}
                  min={1}
                  max={23}
                />
              </InkFormField>
              <InkFormField label={t('schedule.form.minutePast')}>
                <InkNumberField
                  label={t('schedule.form.minutePast')}
                  value={draft.minute}
                  onChange={set('minute')}
                  min={0}
                  max={59}
                />
              </InkFormField>
            </>
          ) : null}

          {draft.timing === 'daily' ? timeField : null}

          {draft.timing === 'weekly' ? (
            <>
              <InkFormField label={t('schedule.form.days')}>
                <View style={styles.chips}>
                  {CRON_WEEKDAYS.map((day) => (
                    <InkChip key={day} selected={draft.weekdays.includes(day)} onPress={() => toggleDay(day)}>
                      {weekdayShortName(day)}
                    </InkChip>
                  ))}
                </View>
              </InkFormField>
              {timeField}
            </>
          ) : null}

          {draft.timing === 'monthly' ? (
            <>
              <InkFormField label={t('schedule.form.dayOfMonth')}>
                <InkNumberField
                  label={t('schedule.form.dayOfMonth')}
                  value={draft.dayOfMonth}
                  onChange={set('dayOfMonth')}
                  min={1}
                  max={31}
                />
              </InkFormField>
              <InkText size="sm" tone="tertiary">{t('schedule.form.dayOfMonthHint')}</InkText>
              {timeField}
            </>
          ) : null}

          {draft.timing === 'custom' ? (
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
          ) : null}

          {preview ? <InkText size="sm" tone="secondary">{preview}</InkText> : null}

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
        </ScrollView>
      </GSheetBody>
    </InkSheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.lg, paddingBottom: Spacing['2xl'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
});
