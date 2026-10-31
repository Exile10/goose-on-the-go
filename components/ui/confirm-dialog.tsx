/**
 * ConfirmDialog — the app's own question box, in place of the system `Alert`.
 *
 * A layer over `InkDialog` rather than a second modal: the dialog shell already lands a screen
 * reader on the title, answers the iOS escape gesture and Android's back, and keeps a question
 * whose words outgrow the screen answerable, with the words scrolling under pinned buttons.
 *
 * Every way out that is not one of the actions is Cancel: the Cancel button, a tap on the
 * backdrop, Android's back button and the iOS two-finger scrub.
 *
 * Callers do not render this directly; `useConfirm()`, `useChoice()` and `useInform()` from
 * `providers/confirm-provider.tsx` do, so a call site reads as `if (await confirm(...))`.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { InkButton, InkDialog } from '@jarida/ink/native';

/** One answer other than Cancel. `danger` is for an answer that loses something. */
export interface ConfirmDialogAction {
  label: string;
  variant: 'primary' | 'danger' | 'quiet';
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** The safe answer's words; Cancel when left out. */
  cancelLabel?: string;
  actions: readonly ConfirmDialogAction[];
  /** What the dismiss button says, when it is not Cancel: OK, for a dialog with nothing to decide. */
  dismissLabel?: string;
  /** The index into `actions` of the answer chosen. */
  onAction: (index: number) => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, cancelLabel, actions, dismissLabel, onAction, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <InkDialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      actions={
        <>
          <InkButton variant="quiet" onPress={onCancel}>
            {cancelLabel ?? dismissLabel ?? t('common.cancel')}
          </InkButton>
          {actions.map((action, index) => (
            <InkButton key={action.label} variant={action.variant} onPress={() => onAction(index)}>
              {action.label}
            </InkButton>
          ))}
        </>
      }
    />
  );
}
