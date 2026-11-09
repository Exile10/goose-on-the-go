/**
 * ContentUnavailable — what a screen shows in place of content that did not arrive.
 *
 * The one view for the two states of `models/content-state.ts` that are not the screen's own:
 *
 * - `unreachable`: the connection indicator at the top is already saying the Pond cannot be used.
 *   This says only that the content will fill in. No cause, no button: a second "Pond
 *   unreachable" with a second Retry under the first is what this replaced.
 * - `failed`: the connection is fine and the read failed anyway. A short title, one sentence, and
 *   the hint "Pull down to try again".
 *
 * Neither form has a button, because trying again is the screen's pull to refresh
 * (`usePullToRefresh`), the same gesture as on every other screen. So this must sit inside the
 * scrollable that carries the `RefreshControl` -- as a `ListEmptyComponent`, or in a `ScrollView`
 * -- or there is nothing to pull. A screen reader cannot easily pull, so the hint is also an
 * element with an `activate` action: TalkBack and VoiceOver read it as a button, and a double tap
 * calls `onRetry`.
 *
 * It is built on Ink's empty state, so a failure sits in the same place and at the same weight as
 * "nothing here yet" would: centred, a quiet icon, no coloured slab. What differs is the words, not
 * the volume. A status code or an exception message never reaches it; the view-model logs those
 * (`logFailure`) and hands over a sentence at most.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkEmptyState, InkIcon, InkText } from '@/components/ui/ink';

import { Spacing } from '@/constants/spacing';

export interface ContentUnavailableProps {
  state: 'unreachable' | 'failed';
  /**
   * The view-model's own sentence for this failure, when it has one more useful than the shared
   * one -- "Your Pond is busy", or a feature the Pond is too old for. Ignored while unreachable.
   */
  reason?: string | null;
  /**
   * Reads the content again. Called by the hint's accessibility action, and once by itself when
   * the connection comes back, because the failure on record is the one the outage caused. A
   * sighted reader pulls the screen instead, which reaches the same read through the screen's
   * `usePullToRefresh`.
   */
  onRetry: () => unknown;
  /** One section of a longer screen, such as a strip on Home, rather than the whole of one. */
  compact?: boolean;
}

export function ContentUnavailable({ state, reason, onRetry, compact }: ContentUnavailableProps) {
  const { t } = useTranslation();
  // Between the connection coming back and the read it prompts settling, the failure on record is
  // stale. Showing it would flash "did not load" at someone whose content is on its way.
  const [resuming, setResuming] = useState(false);
  const previous = useRef(state);
  const retry = useRef(onRetry);
  useEffect(() => {
    retry.current = onRetry;
  }, [onRetry]);

  useEffect(() => {
    const was = previous.current;
    previous.current = state;
    if (was !== 'unreachable' || state !== 'failed') return;
    setResuming(true);
    void Promise.resolve(retry.current()).finally(() => setResuming(false));
  }, [state]);

  const waiting = state === 'unreachable' || resuming;

  return (
    <View accessibilityLiveRegion="polite">
      <InkEmptyState
        icon={<InkIcon name={waiting ? 'cloud-off' : 'cloud-alert'} size={compact ? 24 : 28} tone="neutral" />}
        title={waiting ? t('contentState.waitingTitle') : t('contentState.failedTitle')}
        action={
          waiting ? null : (
            <View
              accessible
              accessibilityRole="button"
              accessibilityLabel={t('contentState.pullHint')}
              accessibilityActions={[{ name: 'activate', label: t('common.retry') }]}
              onAccessibilityAction={() => void onRetry()}
            >
              <InkText size="sm" tone="tertiary">
                {t('contentState.pullHint')}
              </InkText>
            </View>
          )
        }
        style={compact ? styles.compact : null}
      >
        {waiting ? t('contentState.waitingBody') : (reason ?? t('contentState.failedBody'))}
      </InkEmptyState>
    </View>
  );
}

const styles = StyleSheet.create({
  compact: { paddingVertical: Spacing.xl },
});
