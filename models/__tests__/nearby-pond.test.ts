import { cardIdFromName, mergeNearby, pruneSightings, signalBars } from '../nearby-pond';

const sighting = (peripheral: string, name: string | null, rssi: number, seenAt = 1) => [peripheral, { peripheral, name, rssi, seenAt }] as const;

describe('nearby Ponds', () => {
  it('reads the card id only from the exact advertised name', () => {
    expect(cardIdFromName('Pond c1cd')).toBe('c1cd');
    expect(cardIdFromName('Pond C1CD')).toBeNull();
    expect(cardIdFromName('Jerry’s MacBook')).toBeNull();
    expect(cardIdFromName('Pond c1cd extra')).toBeNull();
    expect(cardIdFromName(null)).toBeNull();
  });

  it('waits for a name before listing an advertiser', () => {
    expect(mergeNearby(new Map([sighting('a', null, -50)]), [])).toEqual([]);
  });

  it('lists one row per card id, the network’s address beside the radio’s', () => {
    const rows = mergeNearby(new Map([sighting('a', 'Pond c1cd', -55)]), [
      { url: 'https://192.168.1.9:4443', pin: 'sha256/x', setupId: 'C1CD', unclaimed: true, hostname: 'nano' },
    ]);
    expect(rows).toEqual([{ id: 'c1cd', peripheral: 'a', rssi: -55, url: 'https://192.168.1.9:4443', pin: 'sha256/x', hostname: 'nano', seenAt: 1 }]);
  });

  it('leaves out claimed Ponds and ones with no card id on the network', () => {
    const rows = mergeNearby(new Map(), [
      { url: 'https://192.168.1.9:4443', setupId: 'beef', unclaimed: false },
      { url: 'https://192.168.1.10:4443', unclaimed: true },
    ]);
    expect(rows).toEqual([]);
  });

  it('keeps the louder of two advertisers with one card id', () => {
    const rows = mergeNearby(new Map([sighting('far', 'Pond c1cd', -90), sighting('near', 'Pond c1cd', -40)]), []);
    expect(rows.map((r) => r.peripheral)).toEqual(['near']);
  });

  it('puts the strongest first, and network-only Ponds after by id', () => {
    const rows = mergeNearby(new Map([sighting('a', 'Pond aaaa', -80), sighting('b', 'Pond bbbb', -50)]), [
      { url: 'https://192.168.1.11:4443', setupId: 'dddd', unclaimed: true },
      { url: 'https://192.168.1.12:4443', setupId: 'cccc', unclaimed: true },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['bbbb', 'aaaa', 'cccc', 'dddd']);
  });

  it('forgets advertisers that have gone quiet', () => {
    const map = new Map([sighting('a', 'Pond aaaa', -50, 0), sighting('b', 'Pond bbbb', -50, 10_000)]);
    expect(pruneSightings(map, 16_000)).toBe(true);
    expect([...map.keys()]).toEqual(['b']);
    expect(pruneSightings(map, 16_000)).toBe(false);
  });

  it('draws bars from the signal', () => {
    expect([signalBars(null), signalBars(-90), signalBars(-70), signalBars(-50)]).toEqual([0, 1, 2, 3]);
  });
});
