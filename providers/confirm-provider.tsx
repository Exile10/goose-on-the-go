/**
 * ConfirmProvider — one `ConfirmDialog` for the whole app, asked for by promise.
 *
 * Mounted once, inside `InkProvider` in `app/_layout.tsx`. A screen asks a question with
 * `useConfirm()` or `useChoice()` and awaits the answer, which keeps a call site to one line where
 * it used to be an `Alert.alert` with a button array:
 *
 *     const confirm = useConfirm();
 *     if (await confirm({ title, message, confirmLabel, destructive: true })) remove(item);
 *
 * `useInform()` is the same dialog with nothing to decide: one message about something that already
 * happened -- an action that failed -- and a single button that puts it away.
 *
 * Only one question is on screen at a time. A second one asked while the first is open answers
 * the first as Cancel: the newer question is the one the user just caused, and leaving the older
 * promise unsettled would leak whatever its caller was holding.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

import { ConfirmDialog, type ConfirmDialogAction } from '@/components/ui/confirm-dialog';
import { caution } from '@/services/haptics';
import i18n from '@/services/i18n';

/** A yes-or-no question. `destructive` paints the answer red and buzzes a warning on open. */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  /** The safe answer's words, such as "Keep it"; Cancel when left out. */
  cancelLabel?: string;
  destructive?: boolean;
}

/** One answer to a `ChoiceRequest`, carrying the value `choose()` resolves with. */
export interface ChoiceOption<T> {
  label: string;
  value: T;
  /** Paints this answer red, as `ConfirmRequest.destructive` does, and buzzes a warning on open. */
  destructive?: boolean;
}

/**
 * A question with more than one way to say yes. The first option is drawn as the primary one,
 * the rest quiet, so the dialog spends one raised button like any other. A destructive option is
 * drawn red wherever it stands.
 */
export interface ChoiceRequest<T> {
  title: string;
  message: string;
  options: readonly ChoiceOption<T>[];
}

/** Resolves true on the confirm button, false on Cancel, the backdrop or back. */
export type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>;
/** Resolves with the chosen option's value, or null on Cancel, the backdrop or back. */
export type ChooseFn = <T>(request: ChoiceRequest<T>) => Promise<T | null>;

/** Something that already happened, said in the app's own dialog. */
export interface InformRequest {
  title: string;
  message: string;
}

/** Resolves once the dialog is put away, by its button, the backdrop or back. */
export type InformFn = (request: InformRequest) => Promise<void>;

interface Question {
  title: string;
  message: string;
  cancelLabel?: string;
  actions: readonly ConfirmDialogAction[];
  /** The dismiss button's label, when it is not Cancel. */
  dismissLabel?: string;
  /** The index of the action chosen, or null for every way of cancelling. */
  settle: (index: number | null) => void;
}

interface ConfirmApi {
  confirm: ConfirmFn;
  choose: ChooseFn;
  inform: InformFn;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function ConfirmProvider({ children }: PropsWithChildren) {
  // The last question stays in state after it is answered, so the dialog fades out with its words
  // on it rather than blank; `visible` is what opens and closes it.
  const [question, setQuestion] = useState<Question | null>(null);
  const [visible, setVisible] = useState(false);
  const open = useRef<Question | null>(null);

  const ask = useCallback((next: Omit<Question, 'settle'>, destructive: boolean) => {
    return new Promise<number | null>((resolve) => {
      open.current?.settle(null);
      const asked: Question = {
        ...next,
        settle: (index) => {
          if (open.current !== asked) return;
          open.current = null;
          setVisible(false);
          resolve(index);
        },
      };
      open.current = asked;
      setQuestion(asked);
      setVisible(true);
      if (destructive) void caution();
    });
  }, []);

  // A provider that goes away with a question open answers it, rather than stranding its caller.
  useEffect(() => () => open.current?.settle(null), []);

  const api = useMemo<ConfirmApi>(
    () => ({
      confirm: async ({ title, message, confirmLabel, cancelLabel, destructive = false }) => {
        const index = await ask(
          { title, message, cancelLabel, actions: [{ label: confirmLabel, variant: destructive ? 'danger' : 'primary' }] },
          destructive,
        );
        return index === 0;
      },
      choose: async <T,>({ title, message, options }: ChoiceRequest<T>) => {
        const index = await ask(
          {
            title,
            message,
            actions: options.map((o, i) => ({ label: o.label, variant: o.destructive ? 'danger' : i === 0 ? 'primary' : 'quiet' })),
          },
          options.some((o) => o.destructive),
        );
        return index === null ? null : options[index].value;
      },
      inform: async ({ title, message }) => {
        // Nothing to choose between, so no answer but the one that puts it away -- and that one is
        // OK rather than Cancel, because there is nothing to cancel.
        await ask({ title, message, actions: [], dismissLabel: i18n.t('common.ok') }, false);
      },
    }),
    [ask],
  );

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      <ConfirmDialog
        open={visible}
        title={question?.title ?? ''}
        message={question?.message ?? ''}
        cancelLabel={question?.cancelLabel}
        actions={question?.actions ?? []}
        dismissLabel={question?.dismissLabel}
        onAction={(index) => question?.settle(index)}
        onCancel={() => question?.settle(null)}
      />
    </ConfirmContext.Provider>
  );
}

function useConfirmApi(hook: string): ConfirmApi {
  const api = useContext(ConfirmContext);
  if (!api) throw new Error(`${hook} must be used inside <ConfirmProvider>`);
  return api;
}

/** Ask a yes-or-no question in the app's own dialog. */
export function useConfirm(): ConfirmFn {
  return useConfirmApi('useConfirm').confirm;
}

/** Ask a question with several answers in the app's own dialog. */
export function useChoice(): ChooseFn {
  return useConfirmApi('useChoice').choose;
}

/** Say that something went wrong, in the app's own dialog, with one button to put it away. */
export function useInform(): InformFn {
  return useConfirmApi('useInform').inform;
}
