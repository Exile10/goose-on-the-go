/**
 * RenameSheet — a new name for the conversation on screen, typed or asked of Goose.
 *
 * The dashboard's conversation header does both: its title turns into a field, and a Rename button
 * beside it asks the model. Here the title opens this sheet, which holds the two together. A typed
 * name is one the Pond's idle renaming never overwrites; asking Goose replaces whatever is there.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InkButton, InkFormField, InkInput, InkNotice, InkSheet, InkText } from '@/components/ui/ink';

import { confirm, reject } from '@/services/haptics';

export interface RenameSheetProps {
  /** What the conversation is called now, to start the field from. */
  title: string;
  onClose: () => void;
  /** Each resolves to why it was refused, or null once the conversation is named. */
  onRename: (title: string) => Promise<string | null>;
  onNameForMe: () => Promise<string | null>;
}

export function RenameSheet({ title, onClose, onRename, onNameForMe }: RenameSheetProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'goose' | null>(null);

  const run = async (which: 'save' | 'goose', act: () => Promise<string | null>) => {
    setError(null);
    setBusy(which);
    const refused = await act();
    setBusy(null);
    if (refused) {
      void reject();
      setError(refused);
      return;
    }
    void confirm();
    onClose();
  };

  // An unchanged name is not a rename; closing says the same and costs no request.
  const save = () => (name.trim() === title.trim() ? onClose() : run('save', () => onRename(name)));

  return (
    <InkSheet open onClose={onClose} title={t('chat.rename.title')}>
      <InkFormField label={t('chat.rename.name')}>
        <InkInput value={name} onChange={setName} placeholder={t('chat.rename.placeholder')} />
      </InkFormField>
      <InkText size="sm" tone="tertiary">{t('chat.rename.hint')}</InkText>

      {error ? <InkNotice tone="danger">{error}</InkNotice> : null}

      <InkButton variant="primary" block loading={busy === 'save'} disabled={busy !== null} onPress={save}>
        {t('chat.rename.save')}
      </InkButton>
      <InkButton
        variant="quiet"
        icon="sparkle"
        block
        loading={busy === 'goose'}
        disabled={busy !== null}
        onPress={() => void run('goose', onNameForMe)}
      >
        {t('chat.rename.askGoose')}
      </InkButton>
    </InkSheet>
  );
}
