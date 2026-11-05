// Switch Pond's sections: this phone's own Pond, and the other Ponds heard on this network.

import type { DiscoveredPond } from '@/services/discovery';

export interface PondSections {
  /** The paired Pond, heard at an address this phone already has for it. */
  current: DiscoveredPond | null;
  /** The paired Pond, heard only at an address this phone does not have for it: it has moved. */
  moved: DiscoveredPond | null;
  /** Every other Pond heard on this network. */
  others: DiscoveredPond[];
}

/**
 * Sort what discovery heard by whether it is this phone's Pond.
 *
 * The paired Pond is recognised by its pin, the key this phone pinned when it paired, and never by
 * its address: an address belongs to whatever the router hands it to next. The list used to mark
 * the Pond in use by the address in use, which is empty while nothing answers: on 2026-11-03, with
 * the household's Pond restarting, it showed only another household's Pond and marked nothing.
 *
 * An advertised pin proves nothing by itself, since anything on the network can announce one. Here
 * it is only a claim worth trying: every connection to the address is pinned to the saved key, so
 * something repeating the pin cannot answer as the Pond. A Pond that advertises no pin cannot be
 * recognised, and is listed with the others.
 */
export function sectionPonds(
  ponds: readonly DiscoveredPond[],
  paired: { pin: string | null; urls: readonly string[] },
): PondSections {
  const isPaired = (pond: DiscoveredPond) => !!paired.pin && pond.pin === paired.pin;
  const mine = ponds.filter(isPaired);
  const current = mine.find((pond) => paired.urls.includes(pond.url)) ?? null;
  return {
    current,
    moved: current ? null : mine[0] ?? null,
    others: ponds.filter((pond) => !isPaired(pond)),
  };
}
