import { cardIdFromName, cardIdFromService, cardIdOf, keepPicked, mergeNearby, pruneSightings, setupAdvertUuid, signalBars } from '../nearby-pond';

const uuid = (id: string) => `185b51bd-e038-4b6c-99b0-4e2379dd${id}`;
const sighting = (peripheral: string, id: string | null, rssi: number, seenAt = 1, name: string | null = null) =>
  [peripheral, { peripheral, services: id ? [uuid(id)] : [], name, rssi, seenAt }] as const;

describe('nearby Ponds', () => {
  it('reads the card id only from the exact advertised name', () => {
    expect(cardIdFromName('Pond c1cd')).toBe('c1cd');
    expect(cardIdFromName('Pond C1CD')).toBeNull();
    expect(cardIdFromName('Jerry’s MacBook')).toBeNull();
    expect(cardIdFromName('Pond c1cd extra')).toBeNull();
    expect(cardIdFromName(null)).toBeNull();
  });

  it('reads the card id from the last two bytes of the advertised setup UUID', () => {
    expect(setupAdvertUuid('7f3a')).toBe('185b51bd-e038-4b6c-99b0-4e2379dd7f3a');
    expect(cardIdFromService('185b51bd-e038-4b6c-99b0-4e2379dd7f3a')).toBe('7f3a');
    // CoreBluetooth spells UUIDs in capitals.
    expect(cardIdFromService('185B51BD-E038-4B6C-99B0-4E2379DD7F3A')).toBe('7f3a');
    expect(cardIdFromService('185b51bd-e038-4b6c-99b0-4e2379de7f3a')).toBeNull();
    expect(cardIdFromService('0000180f-0000-1000-8000-00805f9b34fb')).toBeNull();
  });

  it('takes the UUID’s id, and lets a Pond name only veto it', () => {
    expect(cardIdOf({ services: [uuid('7f3a')], name: null })).toBe('7f3a');
    expect(cardIdOf({ services: [uuid('7f3a')], name: 'Pond 7f3a' })).toBe('7f3a');
    expect(cardIdOf({ services: [uuid('7f3a')], name: 'Pond c1cd' })).toBeNull();
    // A name that is not a Pond's says nothing about the card: a label, not a contradiction.
    expect(cardIdOf({ services: [uuid('7f3a')], name: 'nano' })).toBe('7f3a');
    expect(cardIdOf({ services: [], name: 'Pond 7f3a' })).toBeNull();
    expect(cardIdOf({ services: [uuid('7f3a'), uuid('c1cd')], name: null })).toBeNull();
    expect(cardIdOf({ services: [uuid('7f3a'), uuid('7F3A')], name: null })).toBe('7f3a');
  });

  it('lists an advertiser without waiting for a name', () => {
    expect(mergeNearby(new Map([sighting('a', '7f3a', -50)]), []).map((r) => r.id)).toEqual(['7f3a']);
    expect(mergeNearby(new Map([sighting('a', null, -50, 1, 'Pond 7f3a')]), [])).toEqual([]);
  });

  it('drops an advertiser whose name names another card', () => {
    expect(mergeNearby(new Map([sighting('a', '7f3a', -50, 1, 'Pond c1cd')]), [])).toEqual([]);
  });

  it('lists one row per card id, the network’s address beside the radio’s', () => {
    const rows = mergeNearby(new Map([sighting('a', 'c1cd', -55)]), [
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

  // A set-up Pond whose pairing lock holds advertises over Bluetooth while it is on the network.
  it('lists no row for a Pond heard over Bluetooth that this network already lists as set up', () => {
    const rows = mergeNearby(new Map([sighting('a', 'beef', -50), sighting('b', '7f3a', -60)]), [
      { url: 'https://192.168.1.9:4443', pin: 'sha256/x', setupId: 'BEEF', unclaimed: false, hostname: 'nano' },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['7f3a']);
  });

  it('keeps the louder of two advertisers with one card id', () => {
    const rows = mergeNearby(new Map([sighting('far', 'c1cd', -90), sighting('near', 'c1cd', -40)]), []);
    expect(rows.map((r) => r.peripheral)).toEqual(['near']);
  });

  it('puts the strongest first, and network-only Ponds after by id', () => {
    const rows = mergeNearby(new Map([sighting('a', 'aaaa', -80), sighting('b', 'bbbb', -50)]), [
      { url: 'https://192.168.1.11:4443', setupId: 'dddd', unclaimed: true },
      { url: 'https://192.168.1.12:4443', setupId: 'cccc', unclaimed: true },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['bbbb', 'aaaa', 'cccc', 'dddd']);
  });

  it('keeps the picked Pond listed once it stops being heard', () => {
    const [row] = mergeNearby(new Map([sighting('a', '7f3a', -50)]), []);
    expect(keepPicked([], row)).toEqual([row]);
    expect(keepPicked([row], { ...row, rssi: -90 })).toEqual([row]);
    expect(keepPicked([row], null)).toEqual([row]);
  });

  it('forgets advertisers that have gone quiet', () => {
    const map = new Map([sighting('a', 'aaaa', -50, 0), sighting('b', 'bbbb', -50, 10_000)]);
    expect(pruneSightings(map, 16_000)).toBe(true);
    expect([...map.keys()]).toEqual(['b']);
    expect(pruneSightings(map, 16_000)).toBe(false);
  });

  it('draws bars from the signal', () => {
    expect([signalBars(null), signalBars(-90), signalBars(-70), signalBars(-50)]).toEqual([0, 1, 2, 3]);
  });
});
