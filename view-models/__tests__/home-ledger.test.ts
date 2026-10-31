/**
 * Home's Right now ledger: a line only where there is a fact, in a fixed order, and each line
 * saying its fact once.
 */

import i18n from '@/services/i18n';
import { homeLedger, type LedgerFacts } from '@/view-models/home-ledger';

const NOW = new Date('2026-10-31T18:00:00');

function facts(over: Partial<LedgerFacts> = {}): LedgerFacts {
  return {
    nowPlaying: null,
    nextRoutine: null,
    now: NOW,
    devices: null,
    outdoor: null,
    reminders: null,
    ...over,
  };
}

const reminders = (more: number): LedgerFacts['reminders'] => ({
  first: { id: 'r1', text: 'Call the plumber', due: null, said: 'Yesterday' },
  more,
});

describe('homeLedger', () => {
  it('draws no line with nothing behind it', () => {
    expect(homeLedger(facts())).toEqual([]);
  });

  it('keeps one order, whatever arrives first', () => {
    const lines = homeLedger(
      facts({
        reminders: reminders(0),
        outdoor: { temp: 18, place: null },
        devices: { online: 4, total: 9 },
        nextRoutine: { label: 'Lights out', nextRun: new Date('2026-10-31T23:00:00') },
        nowPlaying: { state: 'playing', track: 'Midnight City', artist: 'M83' },
      }),
    );
    expect(lines.map((l) => l.kind)).toEqual(['playing', 'next', 'devices', 'outside', 'remember']);
  });

  // "Nothing playing" took half a row to say silence; on a glance it is not news.
  it('says nothing about music that is not playing', () => {
    expect(homeLedger(facts({ nowPlaying: { state: 'idle' } }))).toEqual([]);
  });

  it('names the artist when there is one, and the track alone when not', () => {
    const [withArtist] = homeLedger(facts({ nowPlaying: { state: 'playing', track: 'Midnight City', artist: 'M83' } }));
    expect(withArtist.value).toBe(i18n.t('home.ledger.playingBy', { track: 'Midnight City', artist: 'M83' }));
    const [alone] = homeLedger(facts({ nowPlaying: { state: 'playing', track: 'Midnight City', artist: null } }));
    expect(alone.value).toBe('Midnight City');
  });

  it('gives the next routine its time, and how long until it as the quiet part', () => {
    const [line] = homeLedger(facts({ nextRoutine: { label: 'Lights out', nextRun: new Date('2026-10-31T23:00:00') } }));
    expect(line.value).toMatch(/^Lights out at /);
    expect(line.detail).toBe(i18n.t('home.inHours', { count: 5 }));
  });

  it('states the online count only about a list that is known and not empty', () => {
    expect(homeLedger(facts({ devices: null }))).toEqual([]);
    expect(homeLedger(facts({ devices: { online: 0, total: 0 } }))).toEqual([]);
    const [line] = homeLedger(facts({ devices: { online: 4, total: 9 } }));
    expect(line.value).toBe(i18n.t('home.ledger.devicesOnline', { online: 4, total: 9 }));
  });

  // The Pond's weather is for where the Pond is, which is not always where the reader is.
  it('says where the temperature is for, rounded to a whole degree', () => {
    const [placed] = homeLedger(facts({ outdoor: { temp: 18.4, place: 'Nairobi' } }));
    expect(placed.value).toBe(i18n.t('home.ledger.outsideIn', { temp: 18, place: 'Nairobi' }));
    const [bare] = homeLedger(facts({ outdoor: { temp: 18.6, place: null } }));
    expect(bare.value).toBe(i18n.t('home.ledger.outside', { temp: 19 }));
  });

  it('names the first reminder, and counts the rest only when there are any', () => {
    const [one] = homeLedger(facts({ reminders: reminders(0) }));
    expect(one).toEqual({ kind: 'remember', value: 'Call the plumber', detail: null });
    const [three] = homeLedger(facts({ reminders: reminders(2) }));
    expect(three.detail).toBe(i18n.t('home.ledger.more', { count: 2 }));
  });
});
