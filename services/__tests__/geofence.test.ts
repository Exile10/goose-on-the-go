/**
 * The geofence task's payload, read without trusting it: only a region with a name, entered or
 * left, becomes an event for the Pond.
 */

import { placeEventFrom } from '@/services/geofence';

describe('reading a geofence event', () => {
  it('reads entering as arriving and leaving as leaving', () => {
    expect(placeEventFrom({ eventType: 1, region: { identifier: 'p-home' } }, 1, 2)).toEqual({ placeId: 'p-home', transition: 'arrive' });
    expect(placeEventFrom({ eventType: 2, region: { identifier: 'p-home' } }, 1, 2)).toEqual({ placeId: 'p-home', transition: 'leave' });
  });

  it('drops anything else', () => {
    expect(placeEventFrom({ eventType: 3, region: { identifier: 'p' } }, 1, 2)).toBeNull();
    expect(placeEventFrom({ eventType: 1, region: {} }, 1, 2)).toBeNull();
    expect(placeEventFrom(null, 1, 2)).toBeNull();
  });
});
