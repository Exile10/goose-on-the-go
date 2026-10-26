/**
 * The words the vision screens say, and the rules behind them: what an event means, what is
 * filtered, what the pipeline's state reads as, and which automations are worth offering.
 */

import {
  EVENT_TYPES,
  buildStarters,
  cameraRules,
  describeCameraTrigger,
  describeEvent,
  describeFacts,
  describeMeasures,
  describeSeen,
  describeSignal,
  describeVision,
  faceOf,
  filterLabel,
  fractionFromPercent,
  matchesFilter,
  measureOfSignal,
  peopleBlock,
  percentText,
  requestFromEvent,
  signalOfEvent,
  signalOptions,
  summaryLine,
  toggleWatchedType,
  unacknowledgedCount,
  watchedTypes,
  EVENT_FILTERS,
  type StarterInputs,
} from '@/models/vision';
import type { CameraEvent, Rule, VisionStatus } from '@/services/types';

function event(over: Partial<CameraEvent> = {}): CameraEvent {
  return {
    id: 1,
    camera_id: 'camera-1',
    event_type: 'person',
    confidence: 0.94,
    snapshot_path: null,
    snapshot_url: '/api/v1/camera/events/1/snapshot',
    metadata: null,
    acknowledged: false,
    created_at: '2026-10-19T08:00:01+00:00',
    ...over,
  };
}

const known = event({ metadata: { face_detected: true, face_unknown: false, identified_profile: 'amina', face_confidence: 0.81 } });
const stranger = event({ metadata: { face_detected: true, face_unknown: true, face_confidence: 0.41 } });
const motion = event({ event_type: 'motion', confidence: 0.12, metadata: { changed_fraction: 0.12, source: 'vision' } });

const names = (id: string) => ({ amina: 'Amina', baraka: 'Baraka' })[id as 'amina'] ?? null;

describe('the kinds of event the pond watches for', () => {
  it('reads an empty list as every kind, as the pond does', () => {
    expect(watchedTypes([])).toEqual([...EVENT_TYPES]);
    expect(watchedTypes(['pet'])).toEqual(['pet']);
  });

  it('turns one kind off from "every kind" by naming the rest', () => {
    expect(toggleWatchedType([], 'pet', false)).toEqual(EVENT_TYPES.filter((t) => t !== 'pet'));
  });

  it('keeps the usual order, and what the pond stored that this app has no name for', () => {
    expect(toggleWatchedType(['package', 'raccoon'], 'motion', true)).toEqual(['motion', 'package', 'raccoon']);
  });

  // An empty list would mean every kind, so switching off the last one would switch all of them on.
  it('refuses to leave none', () => {
    expect(toggleWatchedType(['pet'], 'pet', false)).toBeNull();
  });
});

describe('what a face in an event says', () => {
  it('reads a recognised face, an unknown one, and no face', () => {
    expect(faceOf(known)).toEqual({ detected: true, unknown: false, profileId: 'amina', confidence: 0.81 });
    expect(faceOf(stranger)).toEqual({ detected: true, unknown: true, profileId: null, confidence: 0.41 });
    expect(faceOf(event())).toEqual({ detected: false, unknown: false, profileId: null, confidence: null });
  });

  it('reads the event kind too, for a pond that records a face as its own kind', () => {
    expect(faceOf(event({ event_type: 'face_unknown' })).unknown).toBe(true);
    expect(faceOf(event({ event_type: 'face_detected' })).detected).toBe(true);
  });

  it('never calls a face unknown when it matched somebody', () => {
    expect(faceOf(event({ metadata: { face_unknown: true, identified_profile: 'amina' } })).unknown).toBe(false);
  });
});

describe('the title of an event', () => {
  it('names the person the pond recognised', () => {
    expect(describeEvent(known, names)).toBe('Amina was seen');
  });

  it('does not make up a name for a profile the household no longer has', () => {
    expect(describeEvent(event({ metadata: { identified_profile: 'gone' } }), names)).toBe('Someone your Pond recognised');
  });

  it('says someone the pond does not know for a face that matched nobody', () => {
    expect(describeEvent(stranger, names)).toBe("Someone your Pond doesn't know");
  });

  it('falls back to what was seen, in the Pond’s own word for a kind it has no name for', () => {
    expect(describeEvent(event(), names)).toBe('A person');
    expect(describeEvent(motion, names)).toBe('Movement');
    expect(describeSeen({ event_type: 'raccoon' })).toBe('raccoon');
    expect(describeSeen({ event_type: '  ' })).toBe('Something');
  });
});

describe('how the pond measured it', () => {
  it('says how much of the picture changed for movement, never "sure"', () => {
    expect(describeMeasures(motion)).toEqual(['12% of the picture changed']);
  });

  it('says how sure the detector was for a detection', () => {
    expect(describeMeasures(event())).toEqual(['94% sure']);
    expect(describeMeasures(event({ confidence: 1.2 }))).toEqual(['100% sure']);
  });

  it('adds the face match, and calls the nearest candidate of an unknown face by that name', () => {
    expect(describeMeasures(known)).toEqual(['94% sure', 'Face match 81%']);
    expect(describeMeasures(stranger)).toEqual(['94% sure', 'Closest match 41%']);
  });

  it('says nothing for an event with no score', () => {
    expect(describeMeasures(event({ confidence: null }))).toEqual([]);
  });

  it('puts the most telling measure on a row', () => {
    expect(summaryLine(known)).toBe('Face match 81%');
    expect(summaryLine(motion)).toBe('12% of the picture changed');
    expect(summaryLine(event({ confidence: null }))).toBeNull();
  });
});

describe('the facts of an event', () => {
  const facts = (e: CameraEvent) => Object.fromEntries(describeFacts(e, names).map((f) => [f.label, f.value]));

  it('lists what was seen, how sure the detector was, where and when', () => {
    expect(facts(event())).toEqual({
      Detected: 'A person',
      'Detector confidence': '94%',
      Camera: 'camera-1',
      When: expect.stringContaining('Oct'),
    });
  });

  it('says how much of the picture changed for movement, and does not claim a detector', () => {
    const f = facts(motion);
    expect(f['Picture change']).toBe('12%');
    expect(f['Detector confidence']).toBeUndefined();
  });

  it('names the person recognised and how closely the face matched', () => {
    const f = facts(known);
    expect(f.Face).toBe('Recognised as Amina');
    expect(f['Face match']).toBe('81%');
    expect(f['Closest match']).toBeUndefined();
  });

  it('calls the nearest candidate of an unknown face that, and says it was not recognised', () => {
    const f = facts(stranger);
    expect(f.Face).toBe('Not recognised');
    expect(f['Closest match']).toBe('41%');
    expect(f['Face match']).toBeUndefined();
  });

  it('does not invent a name for a profile the household no longer has', () => {
    expect(facts(event({ metadata: { face_detected: true, identified_profile: 'gone' } })).Face).toBe('Recognised');
  });

  it('leaves out what the pond did not record', () => {
    const f = facts(event({ confidence: null, camera_id: '', created_at: '' }));
    expect(Object.keys(f)).toEqual(['Detected']);
  });
});

describe('the filters', () => {
  const batch = [
    event({ id: 1 }),
    event({ id: 2, event_type: 'pet' }),
    event({ id: 3, event_type: 'vehicle' }),
    event({ id: 4, event_type: 'package', acknowledged: true }),
    { ...motion, id: 5 },
    { ...known, id: 6 },
    { ...stranger, id: 7 },
  ];
  const ids = (filter: (typeof EVENT_FILTERS)[number]) => batch.filter((e) => matchesFilter(e, filter)).map((e) => e.id);

  it('keeps every event under All', () => {
    expect(ids('all')).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('counts a person, and anyone whose face was found, as people', () => {
    expect(ids('people')).toEqual([1, 6, 7]);
  });

  it('keeps faces, and separately the ones the pond does not know', () => {
    expect(ids('faces')).toEqual([6, 7]);
    expect(ids('unknownFaces')).toEqual([7]);
  });

  it('keeps one kind under each of the rest', () => {
    expect(ids('motion')).toEqual([5]);
    expect(ids('pets')).toEqual([2]);
    expect(ids('vehicles')).toEqual([3]);
    expect(ids('packages')).toEqual([4]);
  });

  it('keeps what nobody has acknowledged', () => {
    expect(ids('unacknowledged')).toEqual([1, 2, 3, 5, 6, 7]);
    expect(unacknowledgedCount(batch)).toBe(6);
  });

  it('names every filter in a household’s words', () => {
    expect(EVENT_FILTERS.map(filterLabel)).toEqual([
      'All', 'People', 'Faces', 'Unknown faces', 'Movement', 'Pets', 'Vehicles', 'Packages', 'Unacknowledged',
    ]);
  });
});

describe('what the pipeline is doing', () => {
  const NOW = Date.parse('2026-10-26T12:00:30Z');
  const status = (over: Partial<VisionStatus> = {}): VisionStatus => ({
    cameras_enabled: true,
    vision_enabled: true,
    state: 'running',
    camera_id: 'camera-1',
    source: '/dev/video0',
    source_kind: 'discovered',
    fps: 1,
    last_frame_at: '2026-10-26T12:00:29Z',
    last_event_at: null,
    last_error: null,
    restarts: 0,
    classifier: { available: true },
    faces: { available: true, enrolled_people: 2 },
    event_listeners: 0,
    ...over,
  });

  it('says what is being watched and how often', () => {
    const v = describeVision(status(), NOW);
    expect(v.sentence).toBe('Watching camera-1, 1 picture a second.');
    expect(v.label).toBe('Live');
    expect(v.tone).toBe('success');
    expect(describeVision(status({ fps: 2 }), NOW).sentence).toBe('Watching camera-1, 2 pictures a second.');
    expect(describeVision(status({ fps: null }), NOW).sentence).toBe('Watching camera-1.');
  });

  it('says which camera, and how it was found', () => {
    expect(describeVision(status(), NOW).details).toContain('Camera: /dev/video0, found by your Pond.');
    expect(describeVision(status({ source: 'rtsp://***@10.0.0.4/live', source_kind: 'configured' }), NOW).details).toContain(
      'Camera: rtsp://***@10.0.0.4/live.',
    );
  });

  it('owns up to a missing detector, since everything it records is then plain movement', () => {
    expect(describeVision(status({ classifier: { available: false } }), NOW).details).toContain(
      'No detector is loaded, so everything it records is plain movement.',
    );
  });

  it('says how long ago a dropped stream dropped, and why', () => {
    const v = describeVision(
      status({ state: 'reconnecting', last_frame_at: '2026-10-26T11:59:48Z', last_error: 'connection reset' }),
      NOW,
    );
    expect(v.sentence).toBe('Reconnecting. The stream dropped 42 s ago: connection reset');
    expect(v.tone).toBe('warning');
  });

  it('counts a drop in minutes once it has been a while, and does not invent a reason', () => {
    const v = describeVision(status({ state: 'reconnecting', last_frame_at: '2026-10-26T11:50:30Z' }), NOW);
    expect(v.sentence).toBe('Reconnecting. The stream dropped 10 min ago.');
  });

  it('does not claim a drop for a stream that never showed a picture', () => {
    expect(describeVision(status({ state: 'reconnecting', last_frame_at: null, last_error: 'timed out' }), NOW).sentence).toBe(
      'Reconnecting. camera-1 has not shown a picture yet: timed out',
    );
  });

  it('says when it is looking, starting, off, or held back by Privacy', () => {
    expect(describeVision(status({ state: 'no_camera', camera_id: null }), NOW).sentence).toBe(
      'Looking for a camera. None is set up, and your Pond has not found one plugged in.',
    );
    expect(describeVision(status({ state: 'starting' }), NOW).sentence).toContain('Starting up');
    expect(describeVision(status({ state: 'off' }), NOW).sentence).toBe('Switched off. Your Pond is not watching the camera.');
    const consent = describeVision(status({ state: 'consent_off', cameras_enabled: false }), NOW);
    expect(consent.sentence).toBe('The camera is off in Privacy, so your Pond is not looking.');
    expect(consent.privacy).toBe(true);
  });

  it('mentions restarts only when there were some', () => {
    expect(describeVision(status({ restarts: 0 }), NOW).details.join(' ')).not.toContain('Restarted');
    expect(describeVision(status({ restarts: 1 }), NOW).details).toContain('Restarted 1 time.');
    expect(describeVision(status({ restarts: 3 }), NOW).details).toContain('Restarted 3 times.');
  });
});

describe('signals', () => {
  it('makes an event into the signal that fires for the same kind of thing', () => {
    expect(signalOfEvent(known)).toBe('face:amina');
    expect(signalOfEvent(stranger)).toBe('face_unknown');
    expect(signalOfEvent(event({ event_type: 'package' }))).toBe('package');
  });

  it('knows what each signal’s confidence measures', () => {
    expect(measureOfSignal('motion')).toBe('change');
    expect(measureOfSignal('face_unknown')).toBe('match');
    expect(measureOfSignal('face:amina')).toBe('match');
    expect(measureOfSignal('person')).toBe('sure');
    expect(measureOfSignal(undefined)).toBe('sure');
  });

  it('reads a signal as the clause a trigger is made of', () => {
    expect(describeSignal('package', names)).toBe('a package is seen');
    expect(describeSignal('face:amina', names)).toBe('Amina is seen');
    expect(describeSignal('face:gone', names)).toBe('a specific person is seen');
    expect(describeSignal(undefined, names)).toBe('the camera sees anything');
    expect(describeSignal('raccoon', names)).toBe('raccoon');
  });

  it('writes a camera rule’s trigger as one line', () => {
    expect(describeCameraTrigger({ source: { kind: 'camera', signal: 'package' } }, names)).toBe('When a package is seen');
    expect(
      describeCameraTrigger({ source: { kind: 'camera', signal: 'person' }, condition: { op: 'gte', value: 0.8, after: '22:00', before: '06:00' } }, names),
    ).toBe('When a person is seen, at least 80% sure, between 22:00 and 06:00');
    expect(
      describeCameraTrigger({ source: { kind: 'camera', signal: 'face:amina' }, condition: { op: 'gt', value: 0.6 } }, names),
    ).toBe('When Amina is seen, more than 60% match');
    expect(
      describeCameraTrigger({ source: { kind: 'camera', signal: 'motion' }, condition: { op: 'gte', value: 0.2, after: '20:00' } }, names),
    ).toBe('When movement is seen, at least 20% of the picture changed, after 20:00');
  });

  it('offers every signal, then each person by name, and says what would leave one idle', () => {
    const options = signalOptions(
      [
        { profile_id: 'amina', name: 'Amina', enrollments: 4 },
        { profile_id: 'baraka', name: 'Baraka', enrollments: 0 },
      ],
      ['motion', 'person'],
      false,
    );
    expect(options.map((o) => o.value)).toEqual(['', ...EVENT_TYPES, 'face:amina', 'face:baraka']);
    expect(options[0].label).toBe('Anything the camera sees');
    const byValue = Object.fromEntries(options.map((o) => [o.value, o]));
    expect(byValue.motion.hint).toBeNull();
    expect(byValue.package.hint).toContain('Not being watched');
    // A face kind is idle while recognition is off, however the kinds are set.
    expect(byValue.face_detected.hint).toContain('Not being watched');
    expect(byValue['face:amina']).toMatchObject({ label: 'Amina', hint: 'When their face is recognised' });
    expect(byValue['face:baraka'].hint).toBe("Your Pond doesn't know their face yet");
  });

  it('offers every kind as watched when the pond watches for all', () => {
    const options = signalOptions([], [], true);
    expect(options.filter((o) => o.hint !== null)).toEqual([]);
  });
});

describe('starters', () => {
  const rules = (...r: Partial<Rule>[]): Rule[] =>
    r.map((over, i) => ({
      id: `r${i}`, name: 'x', paused: false, currently_running: false, created_at: 't', last_fired: null, cooldown_secs: 60,
      source: { kind: 'camera', signal: 'package' }, actions: [{ type: 'notify', title: 'a', body: 'b' }], ...over,
    }));
  const inputs = (over: Partial<StarterInputs> = {}): StarterInputs => ({
    people: [
      { profile_id: 'amina', name: 'Amina', enrollments: 4 },
      { profile_id: 'baraka', name: 'Baraka', enrollments: 0 },
    ],
    watched: [],
    faceRecognition: true,
    facesAvailable: true,
    rules: [],
    ...over,
  });

  it('builds them from the kinds watched for and the people known by face', () => {
    const starters = buildStarters(inputs());
    expect(starters.map((s) => s.id)).toEqual(['unknown-face', 'package', 'greet:amina', 'night']);
    expect(starters.map((s) => s.title)).toEqual([
      "Tell me when someone your Pond doesn't know is seen",
      'Tell me when a package arrives',
      'When Amina arrives, ask Goose to greet them',
      'Tell me about movement at night',
    ]);
  });

  it('asks Goose to greet by name, and not more than every half hour', () => {
    const greet = buildStarters(inputs()).find((s) => s.id === 'greet:amina')!;
    expect(greet.request).toMatchObject({
      source: { kind: 'camera', signal: 'face:amina' },
      cooldown_secs: 1800,
      actions: [{ type: 'agent_prompt', prompt: expect.stringContaining('Amina') }],
    });
  });

  it('keeps the night starter to the night', () => {
    const night = buildStarters(inputs()).find((s) => s.id === 'night')!;
    expect(night.request.condition).toEqual({ after: '22:00', before: '06:00' });
  });

  it('offers nothing for a kind the pond is not watching for', () => {
    const starters = buildStarters(inputs({ watched: ['person'] }));
    expect(starters).toEqual([]);
  });

  it('offers nothing about faces while recognition is off or the pond has no face model', () => {
    expect(buildStarters(inputs({ faceRecognition: false })).map((s) => s.id)).toEqual(['package', 'night']);
    expect(buildStarters(inputs({ facesAvailable: false })).map((s) => s.id)).toEqual(['package', 'night']);
  });

  it('does not offer one the household already has', () => {
    const starters = buildStarters(
      inputs({ rules: rules({ source: { kind: 'camera', signal: 'package' } }, { source: { kind: 'camera', signal: 'face:amina' } }) }),
    );
    expect(starters.map((s) => s.id)).toEqual(['unknown-face', 'night']);
  });

  it('still offers movement at night when a rule for any movement exists, but not once the night one does', () => {
    const anytime = rules({ source: { kind: 'camera', signal: 'motion' } });
    expect(buildStarters(inputs({ rules: anytime })).map((s) => s.id)).toContain('night');
    const atNight = rules({ source: { kind: 'camera', signal: 'motion' }, condition: { after: '22:00', before: '06:00' } });
    expect(buildStarters(inputs({ rules: atNight })).map((s) => s.id)).not.toContain('night');
  });

  it('says why no starter about a person is offered', () => {
    expect(peopleBlock(inputs({ facesAvailable: false }))).toBe('unavailable');
    expect(peopleBlock(inputs({ faceRecognition: false }))).toBe('recognitionOff');
    expect(peopleBlock(inputs({ watched: ['person', 'package'] }))).toBe('typeOff');
    expect(peopleBlock(inputs({ people: [{ profile_id: 'baraka', name: 'Baraka', enrollments: 0 }] }))).toBe('nobody');
    expect(peopleBlock(inputs())).toBeNull();
  });

  it('only counts rules that listen to a camera', () => {
    const mixed = rules({ source: { kind: 'sensor', signal: 'temperature' } }, { source: { kind: 'camera', signal: 'pet' } });
    expect(cameraRules(mixed).map((r) => r.source.signal)).toEqual(['pet']);
  });
});

describe('an automation made from an event', () => {
  it('listens for the same kind of thing at the same camera, and notifies with the event’s title', () => {
    expect(requestFromEvent(known, 'Amina was seen')).toEqual({
      name: 'Amina was seen',
      source: { kind: 'camera', device_id: 'camera-1', signal: 'face:amina' },
      actions: [{ type: 'notify', title: 'Amina was seen', body: 'Seen by camera-1.' }],
      cooldown_secs: 60,
    });
  });

  it('names no camera for an event that came from none', () => {
    expect(requestFromEvent(event({ camera_id: '' }), 'A person').source).toEqual({ kind: 'camera', signal: 'person' });
  });
});

describe('the percent a camera rule is typed in', () => {
  it('reads the fraction the Pond compares as the percent a person types', () => {
    expect(percentText(0.8)).toBe('80');
    expect(percentText(0.825)).toBe('82.5');
    expect(percentText(0.05)).toBe('5');
    expect(percentText(1)).toBe('100');
  });

  it('turns a typed percent back into that fraction, without float noise', () => {
    expect(fractionFromPercent(80)).toBe(0.8);
    expect(fractionFromPercent(82.5)).toBe(0.825);
    expect(fractionFromPercent(33.333)).toBe(0.3333);
    expect(fractionFromPercent(0)).toBe(0);
    expect(fractionFromPercent(100)).toBe(1);
  });

  it('refuses what is not a percent', () => {
    expect(fractionFromPercent(101)).toBeNull();
    expect(fractionFromPercent(-1)).toBeNull();
    expect(fractionFromPercent(Number.NaN)).toBeNull();
  });

  it('round-trips what a rule holds', () => {
    for (const fraction of [0.05, 0.5, 0.8, 0.825, 0.99]) {
      expect(fractionFromPercent(Number(percentText(fraction)))).toBe(fraction);
    }
  });
});
