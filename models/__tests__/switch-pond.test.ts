import type { DiscoveredPond } from '@/services/discovery';
import { sectionPonds } from '../switch-pond';

const MINE = `sha256/${'M'.repeat(43)}=`;
const THEIRS = `sha256/${'T'.repeat(43)}=`;

const pond = (address: string, pin?: string, name = 'Pond Hub @ nano'): DiscoveredPond => ({
  id: `${address}:4443`, name, address, port: 4443, url: `https://${address}:4443`, pin, unclaimed: false,
});

const paired = { pin: MINE, urls: ['https://192.168.1.10:4443'] };

describe("Switch Pond's sections", () => {
  it('puts this phone\'s Pond on top by its pin, and lists the rest as others', () => {
    const mine = pond('192.168.1.10', MINE);
    const neighbour = pond('192.168.1.11', THEIRS);
    expect(sectionPonds([neighbour, mine], paired)).toEqual({ current: mine, moved: null, others: [neighbour] });
  });

  it('marks nothing while this phone\'s Pond is not answering, and never takes another Pond for it', () => {
    // 2026-11-03: the household's Pond restarting, a neighbour's on the network.
    const neighbour = pond('192.168.1.11', THEIRS);
    expect(sectionPonds([neighbour], paired)).toEqual({ current: null, moved: null, others: [neighbour] });
  });

  it('does not take a Pond at the saved address for this one when its pin is another\'s', () => {
    const squatter = pond('192.168.1.10', THEIRS);
    expect(sectionPonds([squatter], paired)).toEqual({ current: null, moved: null, others: [squatter] });
  });

  it('offers a new address only for a Pond announcing this phone\'s pin', () => {
    const moved = pond('192.168.1.23', MINE);
    expect(sectionPonds([moved], paired)).toEqual({ current: null, moved, others: [] });
  });

  it('does not call it moved while it also answers at an address this phone has', () => {
    const home = pond('192.168.1.10', MINE);
    const second = pond('192.168.1.23', MINE);
    expect(sectionPonds([second, home], paired)).toEqual({ current: home, moved: null, others: [] });
  });

  it('recognises nothing without a pin to recognise it by', () => {
    const unpinned = pond('192.168.1.10');
    expect(sectionPonds([unpinned], paired).current).toBeNull();
    expect(sectionPonds([unpinned], { pin: null, urls: paired.urls })).toEqual({ current: null, moved: null, others: [unpinned] });
  });
});
