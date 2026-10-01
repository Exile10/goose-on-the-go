/**
 * How much of the bottom bar is showing, and who decides it.
 *
 * The decision is not here. It is `nextStage` in `@jarida/ink/headless` — a
 * pure function with hysteresis, so a thumb resting on a threshold does not
 * make the bar strobe. This file is only the wiring React Native needs and the
 * web does not: there is no window to listen to, so each list hands its own
 * offset up and the bar reads the stage back down.
 *
 * Three stages, and the last one is Ink's own:
 *
 *     expanded    the bar, whole
 *     condensed   it keeps its shape and drops to essentials
 *     collapsed   one control, carrying the current destination's glyph
 *
 * Pressing that control restores the bar and does not navigate, because the
 * reader contracted it by scrolling rather than by choosing to. The press has
 * to arrive here and not stop inside Ink; `restore` says why.
 *
 * Two contexts rather than one. Screens need `report`, which never changes;
 * the bar needs `stage`, which changes twice a gesture. Together in one value
 * they would re-render every list on every stage change.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AccessibilityInfo } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { NAVBAR_DEFAULTS, NavbarBehaviour, type NavbarStage } from '@jarida/ink/headless';

/**
 * What a list pads its foot by before the bar has measured itself, which is
 * the first frame only. Close enough that nothing visibly settles.
 */
const ASSUMED_BAR_HEIGHT = 96;

/**
 * Ink's 220 is a page's number. A phone's whole viewport is about 870 points,
 * so a quarter of the screen would go by before the bar moved — long after the
 * reader committed. 120 is past any nudge and inside one thumb flick, which is
 * what the default means on a page tall enough for it.
 */
const PHONE_BEHAVIOUR = { ...NAVBAR_DEFAULTS, collapseAt: 120 };

interface ChromeScroll {
  /** Feed a scroll offset. Publishes a stage only when it changes. */
  report: (y: number) => void;
  /** Bring the bar back, and re-calibrate on the next reading. */
  reset: () => void;
  /** The reader asked for the bar back. Keeps the offset it was asked at. */
  restore: () => void;
  /** The bar's measured height — what a scrolling list clears at its foot. */
  barHeight: number;
}

const NO_CHROME: ChromeScroll = {
  report: () => {},
  reset: () => {},
  restore: () => {},
  barHeight: 0,
};

const ScrollContext = createContext<ChromeScroll>(NO_CHROME);
const StageContext = createContext<NavbarStage>('expanded');
const MeasureContext = createContext<(height: number) => void>(() => {});

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [behaviour] = useState(() => new NavbarBehaviour(PHONE_BEHAVIOUR));
  const [stage, setStage] = useState<NavbarStage>('expanded');
  const [barHeight, setBarHeight] = useState(ASSUMED_BAR_HEIGHT);

  // The first reading after landing on a tab only calibrates. A list keeps its
  // offset while its tab is away, so without this the reader returns to a
  // screen 500px down and their first small scroll measures a 500px delta.
  const calibrating = useRef(true);

  // A screen reader navigates by swiping through elements, not by scrolling to
  // a place, so a bar that leaves on scroll is a bar it cannot find. `enabled`
  // is the state machine's own pin: it answers "expanded" to everything.
  useEffect(() => {
    let live = true;
    const apply = (on: boolean) => {
      if (!live) return;
      behaviour.configure({ enabled: !on });
      if (on) {
        behaviour.set('expanded');
        setStage('expanded');
      }
    };
    void AccessibilityInfo.isScreenReaderEnabled().then(apply);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', apply);
    return () => {
      live = false;
      sub.remove();
    };
  }, [behaviour]);

  const report = useCallback(
    (y: number) => {
      if (calibrating.current) {
        calibrating.current = false;
        behaviour.scrolled(y);
        behaviour.set('expanded');
        setStage('expanded');
        return;
      }
      setStage(behaviour.scrolled(y));
    },
    [behaviour],
  );

  const reset = useCallback(() => {
    calibrating.current = true;
    behaviour.set('expanded');
    setStage('expanded');
  }, [behaviour]);

  // Pressing the contracted bar has to arrive here, not just inside Ink. The
  // component holds its own push and cannot see a scroll that does not change
  // the stage, so a reader who presses and keeps scrolling down would hold a
  // bar that never contracts again. Unlike `reset` this keeps the calibration,
  // because the list has not moved — only the reader's mind.
  const restore = useCallback(() => {
    behaviour.set('expanded');
    setStage('expanded');
  }, [behaviour]);

  const scroll = useMemo<ChromeScroll>(
    () => ({ report, reset, restore, barHeight }),
    [report, reset, restore, barHeight],
  );

  return (
    <ScrollContext.Provider value={scroll}>
      <MeasureContext.Provider value={setBarHeight}>
        <StageContext.Provider value={stage}>{children}</StageContext.Provider>
      </MeasureContext.Provider>
    </ScrollContext.Provider>
  );
}

/**
 * Spread onto a scrolling list and the bar follows it.
 *
 * Also brings the bar back whenever the screen is focused, so arriving on a tab
 * always arrives at navigation.
 */
export function useChromeScroll() {
  const { report, reset } = useContext(ScrollContext);

  useFocusEffect(
    useCallback(() => {
      reset();
    }, [reset]),
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => report(e.nativeEvent.contentOffset.y),
    [report],
  );

  return { onScroll, scrollEventThrottle: 16 } as const;
}

/** The reader reaching for navigation the scroll took away. */
export function useChromeRestore(): () => void {
  return useContext(ScrollContext).restore;
}

/** What a list has to leave clear at its foot for the bar. */
export function useBottomBarInset(): number {
  return useContext(ScrollContext).barHeight;
}

/** The stage itself, for the bar and for anything anchored beside it. */
export function useChromeStage(): NavbarStage {
  return useContext(StageContext);
}

/** The bar reports its own height; nothing else should call this. */
export function useChromeMeasure(): (height: number) => void {
  return useContext(MeasureContext);
}
