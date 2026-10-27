/**
 * Whether the calling screen is in front and the app is in the foreground: the only time a stream
 * may be open. `useLive` answers the same question for a poll. A stream is not a poll, so it cannot
 * ride on that, and one left open behind a closed screen keeps a connection and the radio awake.
 */

import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

export function useScreenActive(): boolean {
  const [focused, setFocused] = useState(false);
  // Only a known background state holds it off: on an Android cold start AppState can read
  // 'unknown' while the screen is plainly on show.
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setForeground(state !== 'background'));
    return () => sub.remove();
  }, []);

  return focused && foreground;
}
