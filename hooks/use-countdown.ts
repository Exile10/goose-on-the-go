import { useCallback, useEffect, useRef, useState } from 'react';

export interface Countdown {
  /** Whole seconds left, 0 when nothing is counting. */
  left: number;
  start: (seconds: number) => void;
  stop: () => void;
}

/** Counts down a wait the Pond named, against the clock rather than ticks, so a backgrounded app does not fall behind. */
export function useCountdown(): Countdown {
  const [left, setLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setLeft(0);
  }, []);

  const start = useCallback((seconds: number) => {
    if (timer.current) clearInterval(timer.current);
    const until = Date.now() + seconds * 1000;
    const remaining = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));
    setLeft(remaining());
    timer.current = setInterval(() => {
      const next = remaining();
      setLeft(next);
      if (next === 0 && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }, 1000);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  return { left, start, stop };
}
