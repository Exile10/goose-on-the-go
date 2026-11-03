import {
  connectionPhase,
  nextCheck,
  unreachableReason,
  UNREACHABLE_AFTER,
  type ConnectionOutage,
} from '../connection';

const outage = (over: Partial<ConnectionOutage> = {}): ConnectionOutage => ({
  failures: 0, reason: null, nextCheckAt: null, lastConnectedAt: null, ...over,
});

describe('why nothing answered, from what was tried', () => {
  it('blames the Wi-Fi when only home addresses were tried', () => {
    expect(unreachableReason(false, 'none')).toBe('local');
  });

  it('names both routes on Wi-Fi when outside access was tried too, however it went', () => {
    expect(unreachableReason(false, 'no_answer')).toBe('local_and_remote');
    expect(unreachableReason(false, 'node_not_ready')).toBe('local_and_remote');
  });

  it('says outside access is not set up on mobile data without it', () => {
    expect(unreachableReason(true, 'none')).toBe('remote_off');
  });

  it('tells a link that never came up from a Pond that did not answer, on mobile data', () => {
    expect(unreachableReason(true, 'node_not_ready')).toBe('remote_link');
    expect(unreachableReason(true, 'no_answer')).toBe('remote');
  });
});

describe('which phase a connection is in', () => {
  it('is connected on either route', () => {
    expect(connectionPhase('local', null)).toBe('connected');
    expect(connectionPhase('remote', null)).toBe('connected');
  });

  it('is connecting on the first check of a launch', () => {
    expect(connectionPhase('reconnecting', null)).toBe('connecting');
    expect(connectionPhase('reconnecting', outage())).toBe('connecting');
  });

  it('calls a Pond that never answered unreachable after its first failed check', () => {
    expect(connectionPhase('disconnected', outage({ failures: 1 }))).toBe('unreachable');
    expect(connectionPhase('reconnecting', outage({ failures: 1 }))).toBe('unreachable');
  });

  it('reconnects a Pond that dropped for the first few checks, then calls it unreachable', () => {
    const seen = { lastConnectedAt: 1 };
    expect(connectionPhase('reconnecting', outage(seen))).toBe('reconnecting');
    for (let failures = 1; failures < UNREACHABLE_AFTER; failures++) {
      expect(connectionPhase('disconnected', outage({ ...seen, failures }))).toBe('reconnecting');
    }
    expect(connectionPhase('disconnected', outage({ ...seen, failures: UNREACHABLE_AFTER }))).toBe('unreachable');
    // A check in flight after that does not take it back to reconnecting.
    expect(connectionPhase('reconnecting', outage({ ...seen, failures: UNREACHABLE_AFTER }))).toBe('unreachable');
  });

  it('keeps trust and pairing apart from the connection', () => {
    expect(connectionPhase('trust', outage({ failures: 4 }))).toBe('trust');
    expect(connectionPhase('unpaired', null)).toBe('pairing');
    expect(connectionPhase('upgrade', null)).toBe('pairing');
    expect(connectionPhase('revoked', null)).toBe('pairing');
  });

  it('calls a disconnect nothing explained unreachable', () => {
    expect(connectionPhase('disconnected', null)).toBe('unreachable');
  });
});

describe('what happens next', () => {
  it('is a check while one is running', () => {
    expect(nextCheck('reconnecting', outage({ nextCheckAt: 9_000 }), 0)).toEqual({ kind: 'checking' });
  });

  it('counts down whole seconds to the next check, rounding up', () => {
    expect(nextCheck('disconnected', outage({ nextCheckAt: 8_000 }), 0)).toEqual({ kind: 'waiting', seconds: 8 });
    expect(nextCheck('disconnected', outage({ nextCheckAt: 8_000 }), 7_100)).toEqual({ kind: 'waiting', seconds: 1 });
  });

  it('is a check once the time has come, since a quiet check does not announce itself', () => {
    expect(nextCheck('disconnected', outage({ nextCheckAt: 8_000 }), 8_000)).toEqual({ kind: 'checking' });
  });

  it('is nothing when no check is planned', () => {
    expect(nextCheck('disconnected', outage(), 0)).toEqual({ kind: 'none' });
    expect(nextCheck('disconnected', null, 0)).toEqual({ kind: 'none' });
  });
});
