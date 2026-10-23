/**
 * The open-link check. A notification can only open Uber or a maps app: any
 * other scheme or host, or a Google URL outside its maps path, is refused.
 */

import {
  allowedUrl,
  linkFromData,
  openRouteFromData,
  rideOfferFromData,
  screenPath,
} from '@/services/notification-link';

const UBER =
  'https://m.uber.com/ul/?action=setPickup&pickup=my_location' +
  '&dropoff[latitude]=-1.319167&dropoff[longitude]=36.927500';

describe('linkFromData', () => {
  it('reads a ride link', () => {
    expect(linkFromData({ action: 'open_url', kind: 'ride', url: UBER, label: 'Open Uber' })).toEqual({
      kind: 'ride',
      url: UBER,
      label: 'Open Uber',
    });
  });

  it('reads a directions link and fills in a missing label', () => {
    const url = 'https://maps.apple.com/?daddr=Kisumu&dirflg=d';
    expect(linkFromData({ action: 'open_url', kind: 'directions', url })).toEqual({
      kind: 'directions',
      url,
      label: 'Open directions',
    });
  });

  it('ignores data with no open_url action', () => {
    expect(linkFromData(undefined)).toBeNull();
    expect(linkFromData({ url: UBER })).toBeNull();
    expect(linkFromData({ action: 'open_app', url: UBER })).toBeNull();
  });

  it('refuses a link on a host it does not know', () => {
    expect(linkFromData({ action: 'open_url', kind: 'ride', url: 'https://evil.example/ul' })).toBeNull();
  });
});

describe('allowedUrl', () => {
  it('accepts the three hosts over https', () => {
    expect(allowedUrl(UBER)).toBe(UBER);
    expect(allowedUrl('https://maps.apple.com/?daddr=Kisumu')).not.toBeNull();
    expect(
      allowedUrl('https://www.google.com/maps/dir/?api=1&destination=Kisumu&travelmode=driving'),
    ).not.toBeNull();
  });

  it('refuses plain http, other schemes and look-alike hosts', () => {
    expect(allowedUrl('http://m.uber.com/ul/')).toBeNull();
    expect(allowedUrl('uber://?action=setPickup')).toBeNull();
    expect(allowedUrl('javascript:alert(1)')).toBeNull();
    expect(allowedUrl('https://m.uber.com.evil.example/ul/')).toBeNull();
    expect(allowedUrl('not a url')).toBeNull();
    expect(allowedUrl(42)).toBeNull();
  });

  it('refuses a google.com link outside maps', () => {
    expect(allowedUrl('https://www.google.com/search?q=x')).toBeNull();
  });

  // Checked as m.uber.com, but iOS opens the raw string on evil.example.
  it('returns the URL it checked, not the string it was given', () => {
    expect(allowedUrl('https://m.uber.com\\@evil.example/')).toBe('https://m.uber.com/@evil.example/');
  });
});

describe('rideOfferFromData', () => {
  const offer = {
    action: 'ride_offer',
    provider: 'uber',
    dropoff: { name: 'JKIA', latitude: -1.319167, longitude: 36.9275 },
    label: 'Get a fare',
  };

  it('reads a ride offer', () => {
    expect(rideOfferFromData(offer)).toEqual({
      provider: 'uber',
      dropoff: { name: 'JKIA', latitude: -1.319167, longitude: 36.9275 },
    });
  });

  it('ignores other actions and malformed drop-offs', () => {
    expect(rideOfferFromData({ ...offer, action: 'open_url' })).toBeNull();
    expect(rideOfferFromData({ ...offer, dropoff: { name: '', latitude: 1, longitude: 1 } })).toBeNull();
    expect(rideOfferFromData({ ...offer, dropoff: { name: 'X', latitude: 91, longitude: 0 } })).toBeNull();
    expect(rideOfferFromData({ ...offer, dropoff: { name: 'X', latitude: 0, longitude: 0 } })).toBeNull();
    expect(rideOfferFromData({ ...offer, dropoff: { name: 'X', latitude: '1', longitude: 2 } })).toBeNull();
    expect(rideOfferFromData(undefined)).toBeNull();
  });
});

describe('openRouteFromData', () => {
  const SCHEDULE = 'timer-6f1c2a9e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
  const RUN = '0c1d2e3f-4a5b-4e5f-8a9b-6f1c2a9e3b4d';

  it('reads a schedule route with its ids', () => {
    expect(openRouteFromData({ open: 'schedule', schedule_id: SCHEDULE, run_id: RUN })).toEqual({
      open: 'schedule',
      scheduleId: SCHEDULE,
      runId: RUN,
    });
  });

  it('reads the devices and chat routes', () => {
    expect(openRouteFromData({ open: 'devices' })).toEqual({ open: 'devices' });
    expect(openRouteFromData({ open: 'chat', proposal_id: 'p-1', rationale: 'why' })).toEqual({ open: 'chat' });
  });

  it('keeps the schedule screen but drops an id that is not a Pond id', () => {
    expect(openRouteFromData({ open: 'schedule', schedule_id: '../settings', run_id: 7 })).toEqual({
      open: 'schedule',
    });
    expect(openRouteFromData({ open: 'schedule', schedule_id: 'x'.repeat(129) })).toEqual({ open: 'schedule' });
  });

  it('reads the conversation a finished reply names, and lands on the wall without one', () => {
    expect(openRouteFromData({ open: 'conversation', session_id: RUN })).toEqual({ open: 'conversation', sessionId: RUN });
    expect(openRouteFromData({ open: 'conversation', session_id: '../settings' })).toEqual({ open: 'chat' });
    expect(openRouteFromData({ open: 'conversation' })).toEqual({ open: 'chat' });
  });

  it('ignores a screen outside the allow-list, and data with no open', () => {
    expect(openRouteFromData({ open: 'settings-advanced' })).toBeNull();
    expect(openRouteFromData({ open: '/(stack)/developer' })).toBeNull();
    expect(openRouteFromData({ open: ['chat'] })).toBeNull();
    expect(openRouteFromData({ action: 'open_url' })).toBeNull();
    expect(openRouteFromData(null)).toBeNull();
  });
});

describe('screenPath', () => {
  it('maps each route to its screen', () => {
    expect(screenPath({ open: 'devices' })).toBe('/(tabs)/devices');
    expect(screenPath({ open: 'chat' })).toBe('/(tabs)/chat');
    expect(screenPath({ open: 'conversation', sessionId: 's-1' })).toEqual({
      pathname: '/conversation',
      params: { session: 's-1' },
    });
  });

  it('opens the schedules list on the schedule the notification names', () => {
    expect(screenPath({ open: 'schedule', scheduleId: 'sched-1', runId: 'run-9' })).toEqual({
      pathname: '/(stack)/schedule',
      params: { schedule_id: 'sched-1' },
    });
  });

  /** A malformed id was dropped by openRouteFromData; the list is still the place to land. */
  it('opens the list alone when there is no schedule id', () => {
    expect(screenPath({ open: 'schedule' })).toBe('/(stack)/schedule');
  });
});
