// A quiet button for an action that loses something: Ink's own quiet button, its text and hairline
// in the danger colour. Ink has no such variant, so a scoped theme recolours it, as the tab bar does.

import React, { useMemo, type ReactNode } from 'react';
import { alpha } from '@jarida/ink';
import { InkButton, InkProvider, useInkTheme, type InkIconSlot } from '@jarida/ink/native';

export function DangerQuietButton({
  children,
  icon,
  disabled,
  onPress,
}: {
  children: ReactNode;
  icon?: InkIconSlot;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useInkTheme();
  const danger = useMemo(
    () => ({ ...theme, color: { ...theme.color, text: theme.color.dangerFg, line: alpha(theme.color.dangerFg, 0.35) } }),
    [theme],
  );
  return (
    <InkProvider theme={danger}>
      <InkButton variant="quiet" icon={icon} disabled={disabled} onPress={onPress}>
        {children}
      </InkButton>
    </InkProvider>
  );
}
