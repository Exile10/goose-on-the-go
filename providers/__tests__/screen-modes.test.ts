/**
 * Which screens talk to the Pond, in a dev build and in a release one.
 *
 * The release answer is the one nothing else here exercises: `__DEV__` is
 * true under Jest and in every dev build, so a release that sent each chat
 * message to the mock reply looked right everywhere but on a phone that had
 * installed it. `resolveScreenReal` takes `isDev` as an argument so that
 * answer can be pinned without a release build.
 */

import {
  DEFAULT_SCREEN_MODES,
  MIGRATION_SCREENS,
  resolveScreenReal,
  type MigrationScreen,
  type ScreenModes,
} from '@/providers/server-provider';

/** A mode for every screen, from a rule, so adding or retiring one leaves this compiling. */
function modes(real: (screen: MigrationScreen, index: number) => boolean): ScreenModes {
  return Object.fromEntries(MIGRATION_SCREENS.map((s, i) => [s, real(s, i)])) as ScreenModes;
}

describe('resolveScreenReal', () => {
  /**
   * THE regression. Chat is real by default, and a release build answered
   * mock for every screen regardless, so each message got the mock reply and
   * none of them reached the Pond.
   */
  it('sends chat to the Pond in a release build', () => {
    // What the provider passes there: nothing loads or flips a toggle, so its
    // state never leaves the defaults.
    const release = { isDev: false, screenModes: DEFAULT_SCREEN_MODES, defaults: DEFAULT_SCREEN_MODES };
    expect(resolveScreenReal('chat', release)).toBe(true);
  });

  /**
   * Web search's mock answers "saved" to any key. In a release build that would show a key as
   * stored when nothing had reached the Pond, so it starts on the Pond like chat does.
   */
  it('sends web search to the Pond in a release build', () => {
    const release = { isDev: false, screenModes: DEFAULT_SCREEN_MODES, defaults: DEFAULT_SCREEN_MODES };
    expect(resolveScreenReal('webSearch', release)).toBe(true);
  });

  /**
   * On mock, a release build showed sample schedules ("Morning briefing") in place of the
   * household's own, and nothing created or edited there reached the Pond. The Automations tab
   * reads the same key.
   */
  it('sends schedules and automations to the Pond in a release build', () => {
    const release = { isDev: false, screenModes: DEFAULT_SCREEN_MODES, defaults: DEFAULT_SCREEN_MODES };
    expect(resolveScreenReal('schedule', release)).toBe(true);
  });

  // Alternating real and mock, with every toggle set the other way, so an
  // answer that reads the wrong record, or neither, cannot pass.
  const defaults = modes((_, i) => i % 2 === 0);
  const toggles = modes((screen) => !defaults[screen]);
  const resolveAll = (isDev: boolean) =>
    modes((screen) => resolveScreenReal(screen, { isDev, screenModes: toggles, defaults }));

  it('gives every screen its default in a release build, whatever its toggle says', () => {
    expect(resolveAll(false)).toEqual(defaults);
  });

  /** The Developer screen's switches, which are how a screen gets wired one at a time. */
  it('gives every screen its toggle in a dev build', () => {
    expect(resolveAll(true)).toEqual(toggles);
  });
});
