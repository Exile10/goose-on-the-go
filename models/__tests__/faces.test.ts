/**
 * The numbers and words behind the Faces screen.
 */

import { describeSamples, initial, knownByFace, orderPeople, sampleCount, strictnessRange, toPercent } from '@/models/faces';

describe('strictness', () => {
  it('reaches either side of the pond’s own, and never to a nonsense end', () => {
    expect(strictnessRange(0.45, null)).toEqual({ min: 0.2, max: 0.7 });
    expect(strictnessRange(0.1, null)).toEqual({ min: 0.05, max: 0.35 });
    expect(strictnessRange(0.95, null)).toEqual({ min: 0.7, max: 0.99 });
  });

  it('widens to hold a value somebody set elsewhere', () => {
    expect(strictnessRange(0.45, 0.9)).toEqual({ min: 0.2, max: 0.9 });
    expect(strictnessRange(0.45, 0.1)).toEqual({ min: 0.1, max: 0.7 });
  });

  it('falls back to a middle default when the pond reports none', () => {
    expect(strictnessRange(0, null)).toEqual({ min: 0.25, max: 0.75 });
  });

  it('shows a fraction as a percent', () => {
    expect(toPercent(0.456)).toBe(46);
    expect(toPercent(1.4)).toBe(100);
  });
});

describe('samples', () => {
  it('says what to do next from how many there are', () => {
    expect(describeSamples(0)).toBe('No samples yet. Take 3 to 5 for a reliable match.');
    expect(describeSamples(1)).toBe('1 sample so far. Take a few more, turning their head a little each time.');
    expect(describeSamples(2)).toBe('2 samples so far. Take a few more, turning their head a little each time.');
    expect(describeSamples(3)).toContain('That is enough to recognise them');
    expect(describeSamples(5)).toContain('That is enough to recognise them');
    expect(describeSamples(6)).toBe('6 samples.');
  });

  it('counts them for a row', () => {
    expect(sampleCount(0)).toBe('No samples');
    expect(sampleCount(1)).toBe('1 sample');
    expect(sampleCount(4)).toBe('4 samples');
  });
});

describe('people', () => {
  const people = [
    { name: 'Zawadi', enrollments: 0 },
    { name: 'Baraka', enrollments: 2 },
    { name: 'Amina', enrollments: 0 },
    { name: 'Chege', enrollments: 5 },
  ];

  it('counts those the pond knows by face', () => {
    expect(knownByFace(people)).toBe(2);
  });

  it('lists those it knows first, then by name', () => {
    expect(orderPeople(people).map((p) => p.name)).toEqual(['Baraka', 'Chege', 'Amina', 'Zawadi']);
  });

  it('stands in for a picture with a name’s first letter', () => {
    expect(initial('  amina')).toBe('A');
    expect(initial('')).toBe('?');
  });
});
