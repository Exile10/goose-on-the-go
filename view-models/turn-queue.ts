/**
 * One turn at a time, and whatever was written meanwhile waiting behind it.
 *
 * A reply can take a minute, and a person with a follow-up should not have to
 * hold it in their head until the answer ends. What they send meanwhile waits
 * here, in the order it was sent, and goes the moment the turn ahead of it
 * settles — however it settles: an answer, a refusal or a dropped connection.
 * A queue that stalled on a failure would hold the next question hostage to
 * the last one.
 *
 * The function that runs a turn is handed over separately, and replaced
 * whenever it changes (`runWith`), so a turn that waited runs through the
 * current one rather than whichever existed when it was written. Until there is
 * one, everything waits.
 *
 * Pure, so the order of things can be tested without a screen.
 */

export type RunTurn<T> = (item: T) => Promise<string | null>;

export interface TurnQueue<T> {
  /** Run now if nothing is running, else wait. Settles with the reply, or null. */
  submit: (item: T) => Promise<string | null>;
  /** Take back what is waiting and matches. It settles null, as if never sent. */
  remove: (match: (item: T) => boolean) => void;
  /** Take back everything waiting. The turn already running is not the queue's to stop. */
  clear: () => void;
  /** The function that runs a turn, from now on. Anything waiting for one starts. */
  runWith: (run: RunTurn<T>) => void;
  /** How many are waiting, not counting the turn that is running. */
  readonly size: number;
}

interface Waiting<T> {
  item: T;
  settle: (reply: string | null) => void;
}

export function createTurnQueue<T>(onChange: (waiting: T[]) => void): TurnQueue<T> {
  let run: RunTurn<T> | null = null;
  let running = false;
  let waiting: Waiting<T>[] = [];

  const publish = () => onChange(waiting.map((w) => w.item));

  const start = (runner: RunTurn<T>, item: T): Promise<string | null> => {
    running = true;
    let turn: Promise<string | null>;
    try {
      turn = runner(item);
    } catch (e) {
      turn = Promise.reject(e);
    }
    // A turn that throws has already said why on screen; here it is only a
    // reply that did not come.
    return turn
      .catch(() => null)
      .finally(() => {
        running = false;
        advance();
      });
  };

  const advance = () => {
    if (running || !run) return;
    const [next, ...rest] = waiting;
    if (!next) return;
    waiting = rest;
    publish();
    void start(run, next.item).then(next.settle);
  };

  const takeBack = (gone: Waiting<T>[]) => {
    publish();
    for (const w of gone) w.settle(null);
  };

  return {
    submit(item) {
      if (run && !running && waiting.length === 0) return start(run, item);
      return new Promise((settle) => {
        waiting = [...waiting, { item, settle }];
        publish();
      });
    },
    remove(match) {
      const gone = waiting.filter((w) => match(w.item));
      if (gone.length === 0) return;
      waiting = waiting.filter((w) => !match(w.item));
      takeBack(gone);
    },
    clear() {
      if (waiting.length === 0) return;
      const gone = waiting;
      waiting = [];
      takeBack(gone);
    },
    runWith(next) {
      run = next;
      advance();
    },
    get size() {
      return waiting.length;
    },
  };
}
