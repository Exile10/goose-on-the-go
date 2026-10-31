/**
 * Unpairing this phone, including from a Pond that will never answer again.
 *
 * The Pond is always asked first, so it forgets this phone whenever it can be reached. When it
 * cannot -- it is off, away from this network, reset, replaced, or something else now answers at
 * its address -- the user is offered "Remove from this phone", with what that leaves behind said
 * plainly: the Pond still lists this phone until it is removed from the Pond's dashboard. Before
 * this, the failure was a system alert saying to try again at home, and a phone whose Pond was
 * gone stayed paired to it for good.
 *
 * A Pond that refuses the session outright has already let this phone go; the provider forgets it
 * then without anything more to ask, so that case arrives here as a success.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useChoice, useConfirm } from '@/providers/confirm-provider';
import { useServer } from '@/providers/server-provider';
import { ApiError } from '@/services/api-client';

/**
 * Why the Pond did not release this phone: nothing answered (`unreachable`, which includes a
 * different machine answering at the address, since that is not this phone's Pond), or the Pond
 * answered and did not release it (`refused`).
 */
export type UnpairFailure = 'unreachable' | 'refused';

/** Sorts a rejection from `unpair`. Only the Pond itself produces an `ApiError`. */
export function classifyUnpairFailure(error: unknown): UnpairFailure {
  return error instanceof ApiError ? 'refused' : 'unreachable';
}

export interface UseUnpair {
  /** True from the confirmed question until the phone is released, forgotten, or kept. */
  unpairing: boolean;
  /** Ask, release, and on a failure offer to forget the Pond on this phone only. Never rejects. */
  start: () => Promise<void>;
}

type Step = 'release' | 'forget';

export function useUnpair(): UseUnpair {
  const { t } = useTranslation();
  const { unpair, forgetLocally } = useServer();
  const confirm = useConfirm();
  const choose = useChoice();
  const [unpairing, setUnpairing] = useState(false);

  const start = useCallback(async () => {
    const yes = await confirm({
      title: t('common.unpair'),
      message: t('profile.unpairWarning'),
      confirmLabel: t('common.unpair'),
      destructive: true,
    });
    if (!yes) return;
    setUnpairing(true);
    let step: Step = 'release';
    try {
      for (;;) {
        if (step === 'release') {
          try {
            await unpair();
            return;
          } catch (error) {
            const failure = classifyUnpairFailure(error);
            console.warn('[unpair] kind=release_failed failure=', failure, 'status=', error instanceof ApiError ? error.status : 'none');
            const unreachable = failure === 'unreachable';
            const next = await choose<Step>({
              title: unreachable ? t('profile.unpairUnreachableTitle') : t('profile.unpairRefusedTitle'),
              message: unreachable ? t('profile.unpairUnreachableBody') : t('profile.unpairRefusedBody'),
              options: [
                { label: t('profile.removeFromPhone'), value: 'forget', destructive: true },
                { label: t('common.retry'), value: 'release' },
              ],
            });
            if (next === null) {
              console.info('[unpair] kind=kept_pairing failure=', failure);
              return;
            }
            step = next;
            continue;
          }
        }
        try {
          await forgetLocally();
          return;
        } catch (error) {
          console.error('[unpair] kind=forget_failed', error);
          const again = await choose({
            title: t('profile.removeFailedTitle'),
            message: t('profile.removeFailedBody'),
            options: [{ label: t('common.retry'), value: true }],
          });
          if (!again) return;
        }
      }
    } finally {
      setUnpairing(false);
    }
  }, [confirm, choose, unpair, forgetLocally, t]);

  return { unpairing, start };
}
