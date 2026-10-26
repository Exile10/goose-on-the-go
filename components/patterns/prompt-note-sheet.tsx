/**
 * PromptNoteSheet — a new assistant note, or new words for one the Pond already holds.
 *
 * A new note takes a name and its words. The name becomes the note's key (`models/prompt-extras.ts`),
 * which the Pond treats as its identity, so editing offers the words alone.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InkButton, InkFormField, InkInput, InkNotice, InkSheet, InkText, InkTextArea } from '@jarida/ink/native';

import { ADVISED_NOTE_LENGTH, noteName } from '@/models/prompt-extras';
import { confirm, reject } from '@/services/haptics';
import type { PromptExtra } from '@/services/types';

export interface PromptNoteSheetProps {
  open: boolean;
  /** The note being reworded, or null for a new one. */
  editing: PromptExtra | null;
  onClose: () => void;
  /** Each resolves to why the note was not saved, or null once the Pond has it. */
  onAdd: (name: string, text: string) => Promise<string | null>;
  onEdit: (extra: PromptExtra, text: string) => Promise<string | null>;
}

export function PromptNoteSheet({ open, editing, onClose, onAdd, onEdit }: PromptNoteSheetProps) {
  const { t } = useTranslation();
  // Mounted afresh for each opening (the screen keys it), so this starts from the note, or blank.
  const [name, setName] = useState('');
  const [text, setText] = useState(editing?.instruction ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const length = text.trim().length;
  const long = length > ADVISED_NOTE_LENGTH;

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    const refused = editing ? await onEdit(editing, text) : await onAdd(name, text);
    setSubmitting(false);
    if (refused) {
      void reject();
      setError(refused);
      return;
    }
    void confirm();
    onClose();
  };

  return (
    <InkSheet
      open={open}
      onClose={onClose}
      title={editing ? t('promptNotes.form.editTitle', { name: noteName(editing.key) }) : t('promptNotes.form.newTitle')}
    >
      {editing ? null : (
        <>
          <InkFormField label={t('promptNotes.form.name')}>
            <InkInput
              label={t('promptNotes.form.name')}
              placeholder={t('promptNotes.form.namePlaceholder')}
              value={name}
              onChange={setName}
            />
          </InkFormField>
          <InkText size="sm" tone="tertiary">{t('promptNotes.form.nameHint')}</InkText>
        </>
      )}

      <InkFormField label={t('promptNotes.form.text')}>
        <InkTextArea
          label={t('promptNotes.form.text')}
          placeholder={t('promptNotes.form.textPlaceholder')}
          value={text}
          onChange={setText}
          rows={3}
          maxRows={8}
        />
      </InkFormField>
      <InkText size="sm" tone="tertiary">
        {t('promptNotes.form.length', { count: length, advised: ADVISED_NOTE_LENGTH })}
      </InkText>
      {long ? <InkNotice tone="warning">{t('promptNotes.form.tooLong')}</InkNotice> : null}

      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}

      <InkButton variant="primary" block disabled={submitting} onPress={submit}>
        {t('promptNotes.form.save')}
      </InkButton>
    </InkSheet>
  );
}
