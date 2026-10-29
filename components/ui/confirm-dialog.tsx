/**
 * ConfirmDialog — the app's own question box, in place of the system `Alert`.
 *
 * Built on `Modal` with Ink's tokens rather than on `InkDialog`, for three things a confirmation
 * needs that `InkDialog` cannot give it: a ref to the title so a screen reader starts there, the
 * iOS escape gesture answering as Cancel, and a backdrop that is not announced as a hardcoded
 * English "Close". The look is `InkDialog`'s -- same type, same backdrop -- plus the raised plate
 * the app's cards carry, so the question reads as a card that came forward.
 *
 * Every way out that is not one of the actions is Cancel: the Cancel button, a tap on the
 * backdrop, Android's back button and the iOS two-finger scrub.
 *
 * Callers do not render this directly; `useConfirm()` and `useChoice()` from
 * `providers/confirm-provider.tsx` do, so a call site reads as `if (await confirm(...))`.
 */

import React, { useCallback, useRef } from 'react';
import { AccessibilityInfo, Modal, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBudget, InkButton, InkEdge, inkText, slantTransform, useInkTheme } from '@jarida/ink/native';

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
  /** The index into `actions` of the answer chosen. */
  onAction: (index: number) => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, cancelLabel, actions, onAction, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const titleRef = useRef<Text>(null);

  const heading = inkText(theme, {
    role: 'display',
    size: 'xl',
    weight: theme.weight.bold,
    italic: true,
    tracking: 'title',
    leading: 'tight',
  });
  const body = inkText(theme, { size: 'sm', color: theme.color.textSecondary });

  // Without this a screen reader is left on whatever row opened the dialog, behind it.
  const focusTitle = useCallback(() => {
    // React Native Web has no sendAccessibilityEvent, and calling it there throws.
    if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent?.(titleRef.current, 'focus');
  }, []);

  return (
    <Modal
      visible={open}
      transparent
      animationType={theme.animate ? 'fade' : 'none'}
      onRequestClose={onCancel}
      onShow={focusTitle}
      statusBarTranslucent
    >
      <Pressable
        testID="confirm-dialog-backdrop"
        // The Cancel button is the announced way out; the backdrop is for a thumb.
        accessible={false}
        onPress={onCancel}
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.space[6],
          backgroundColor: 'rgba(23, 22, 22, 0.42)',
        }}
      >
        {/* A press inside the panel must not reach the backdrop behind it. */}
        <Pressable accessible={false} onPress={() => {}} style={{ width: '100%', maxWidth: 480 }}>
          {/* Its own budget: the plate and the one raised answer are the dialog's two, and they
              must not count against the screen underneath. The label names it in Ink's
              development warning only; no user reads it. */}
          {/* eslint-disable-next-line i18next/no-literal-string */}
          <InkBudget max={2} label="confirm dialog">
            <InkEdge
              radius={theme.radius.lg}
              contentStyle={{ gap: theme.space[3], padding: theme.space[6], backgroundColor: theme.color.surface }}
            >
              <View accessibilityViewIsModal onAccessibilityEscape={onCancel} style={{ gap: theme.space[3] }}>
                <Text
                  ref={titleRef}
                  accessibilityRole="header"
                  style={[heading.style, heading.slant ? { transform: slantTransform(heading.slant) } : null]}
                >
                  {title}
                </Text>
                <Text style={body.style}>{message}</Text>
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    justifyContent: 'flex-end',
                    gap: theme.space[3],
                    marginTop: theme.space[2],
                  }}
                >
                  <InkButton variant="quiet" onPress={onCancel}>
                    {cancelLabel ?? t('common.cancel')}
                  </InkButton>
                  {actions.map((action, index) => (
                    <InkButton key={action.label} variant={action.variant} onPress={() => onAction(index)}>
                      {action.label}
                    </InkButton>
                  ))}
                </View>
              </View>
            </InkEdge>
          </InkBudget>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
