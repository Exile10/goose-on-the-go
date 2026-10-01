/**
 * The queue behind a reply: one turn at a time, in the order they were sent,
 * never stalled by a turn that failed, and able to take back what has not gone.
 */

import { createTurnQueue } from '@/view-models/turn-queue';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every promise callback already due run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A queue whose turns end when the test says, recording what ran and what waited. */
function harness() {
  const ran: string[] = [];
  const waited: string[][] = [];
  const turns = new Map<string, Deferred<string | null>>();
  const queue = createTurnQueue<string>((items) => waited.push(items));
  queue.runWith((item) => {
    ran.push(item);
    const turn = deferred<string | null>();
    turns.set(item, turn);
    return turn.promise;
  });
  return {
    queue,
    ran,
    waiting: () => waited[waited.length - 1] ?? [],
    async finish(item: string, reply: string | null = `re: ${item}`) {
      turns.get(item)?.resolve(reply);
      await settle();
    },
    async fail(item: string) {
      turns.get(item)?.reject(new Error('refused'));
      await settle();
    },
  };
}

describe('createTurnQueue', () => {
  it('runs a turn at once when nothing is running', async () => {
    const h = harness();
    const reply = h.queue.submit('a');
    expect(h.ran).toEqual(['a']);
    expect(h.queue.size).toBe(0);
    await h.finish('a');
    await expect(reply).resolves.toBe('re: a');
  });

  it('holds what is sent meanwhile, and sends it in order as each turn settles', async () => {
    const h = harness();
    const replies = [h.queue.submit('a'), h.queue.submit('b'), h.queue.submit('c')];
    expect(h.ran).toEqual(['a']);
    expect(h.queue.size).toBe(2);
    expect(h.waiting()).toEqual(['b', 'c']);

    await h.finish('a');
    expect(h.ran).toEqual(['a', 'b']);
    expect(h.waiting()).toEqual(['c']);

    await h.finish('b');
    await h.finish('c');
    await expect(Promise.all(replies)).resolves.toEqual(['re: a', 're: b', 're: c']);
    expect(h.waiting()).toEqual([]);
  });

  it('is not held up by a turn that fails', async () => {
    const h = harness();
    const first = h.queue.submit('a');
    const second = h.queue.submit('b');
    await h.fail('a');
    await expect(first).resolves.toBeNull();
    expect(h.ran).toEqual(['a', 'b']);
    await h.finish('b');
    await expect(second).resolves.toBe('re: b');
  });

  it('treats a turn that throws before it starts as a reply that did not come', async () => {
    const queue = createTurnQueue<string>(() => {});
    queue.runWith(() => {
      throw new Error('no');
    });
    await expect(queue.submit('a')).resolves.toBeNull();
    // And the next is not stuck behind it.
    await expect(queue.submit('b')).resolves.toBeNull();
  });

  it('holds what is sent before it can run a turn, and sends it once it can', async () => {
    const queue = createTurnQueue<string>(() => {});
    const reply = queue.submit('early');
    expect(queue.size).toBe(1);
    queue.runWith(async (item) => `re: ${item}`);
    await expect(reply).resolves.toBe('re: early');
    expect(queue.size).toBe(0);
  });

  it('runs a turn that waited through the runner current when its time comes', async () => {
    const h = harness();
    void h.queue.submit('a');
    const waited = h.queue.submit('b');
    const later: string[] = [];
    h.queue.runWith(async (item) => {
      later.push(item);
      return 'from the new runner';
    });
    await h.finish('a');
    expect(later).toEqual(['b']);
    await expect(waited).resolves.toBe('from the new runner');
  });

  it('takes back one waiting message, which then never goes', async () => {
    const h = harness();
    void h.queue.submit('a');
    const taken = h.queue.submit('b');
    void h.queue.submit('c');
    h.queue.remove((item) => item === 'b');
    await expect(taken).resolves.toBeNull();
    expect(h.waiting()).toEqual(['c']);
    await h.finish('a');
    expect(h.ran).toEqual(['a', 'c']);
  });

  it('clears what waits but leaves the running turn to finish, then takes new work', async () => {
    const h = harness();
    const running = h.queue.submit('a');
    const dropped = h.queue.submit('b');
    h.queue.clear();
    await expect(dropped).resolves.toBeNull();
    expect(h.queue.size).toBe(0);

    // Sent after a stop, before the stopped turn has wound down: it waits for it.
    void h.queue.submit('d');
    expect(h.ran).toEqual(['a']);
    await h.finish('a', null);
    await expect(running).resolves.toBeNull();
    expect(h.ran).toEqual(['a', 'd']);
  });
});
