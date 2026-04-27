/**
 * Voice ViewModel
 * Voice state machine for the canvas voice mode.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { VoiceState } from '@/models/voice';

export function useVoice() {
  const [state, setState] = useState<VoiceState>('idle');
  const [vuLevel, setVuLevel] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Simulate VU meter when recording
  useEffect(() => {
    if (state === 'recording') {
      intervalRef.current = setInterval(() => {
        setVuLevel(Math.random() * 0.4 + 0.1);
      }, 200);
    } else {
      setVuLevel(0);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state]);

  const startRecording = useCallback(() => {
    setState('recording');
    // Simulate: after 2.2s, transition to thinking
    setTimeout(() => {
      setState('thinking');
      // Then speaking after another 1s
      setTimeout(() => {
        setState('speaking');
        // Then back to idle
        setTimeout(() => setState('idle'), 1500);
      }, 1000);
    }, 2200);
  }, []);

  const stop = useCallback(() => {
    setState('idle');
  }, []);

  return {
    data: { state, vuLevel },
    actions: { startRecording, stop },
  };
}
