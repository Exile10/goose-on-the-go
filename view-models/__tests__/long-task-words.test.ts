// A task waiting its turn says so in pond-desktop's words (longTaskWords.ts on goose-in-a-pond's
// feat/long-task-queue), and never names another member's task.

import type { LongTaskAhead, LongTaskQueuePlace } from '@/services/types';
import {
  aheadWords,
  choiceGoal,
  ordinal,
  placeWords,
  stopFailedWords,
  stoppedWords,
  stopPickedLabel,
  taskIcon,
  taskLabel,
} from '@/view-models/long-task-words';

const mine: LongTaskAhead = { id: 'a', goal: 'Plan the trip', state: 'running' };
const theirs: LongTaskAhead = { another_member: true };
const second: LongTaskQueuePlace = { position: 2, of: 3, ahead: [mine] };

describe('a task waiting its turn', () => {
  it('says where it is in line instead of saying it is planning', () => {
    expect(taskLabel({ state: 'planning', queue: second })).toBe('Waiting its turn: 2nd in line');
    expect(taskLabel({ state: 'planning', queue: { position: 3, of: 3, ahead: [mine, theirs] } })).toBe('Waiting its turn: 3rd in line');
    expect(taskIcon({ state: 'planning', queue: second })).toBe('schedule');
  });

  it('keeps its own words at the front of the line, once ended, and on an older Pond', () => {
    expect(taskLabel({ state: 'planning', queue: { position: 1, of: 2, ahead: [] } })).toBe('Planning its steps');
    expect(taskLabel({ state: 'cancelled', queue: second })).toBe('Stopped');
    expect(taskLabel({ state: 'planning', queue: null })).toBe('Planning its steps');
    expect(taskLabel({ state: 'planning' })).toBe('Planning its steps');
    expect(taskIcon({ state: 'planning' })).toBe('sparkle');
  });

  it('counts places as people say them', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th',
    ]);
    expect(placeWords(1)).toBe('Working now');
    expect(placeWords(3)).toBe('3rd in line');
  });

  it("says who is ahead without naming another member's task", () => {
    expect(aheadWords([mine])).toBe('Ahead of this one: 1 of your tasks.');
    expect(aheadWords([mine, theirs, mine])).toBe('Ahead of this one: 2 of your tasks and 1 for another member.');
    expect(aheadWords([theirs, theirs])).toBe('Ahead of this one: 2 for other members.');
    expect(aheadWords([theirs, mine, theirs])).not.toContain('Plan the trip');
  });
});

describe('choosing in the line', () => {
  it('marks the task whose card it is', () => {
    expect(choiceGoal('Plan a weekend away', true)).toBe('Plan a weekend away (this one)');
    expect(choiceGoal('Plan the trip', false)).toBe('Plan the trip');
  });

  it('names the one Stop by how many it stops, and says what it did', () => {
    expect(stopPickedLabel(1)).toBe('Stop 1 task');
    expect(stopPickedLabel(2)).toBe('Stop 2 tasks');
    expect(stoppedWords(1)).toBe('Stopped 1 task.');
    expect(stoppedWords(2)).toBe('Stopped 2 tasks.');
    expect(stopFailedWords([{ goal: 'Plan the trip', reason: 'your Pond is busy' }])).toBe('Could not stop Plan the trip: your Pond is busy. Try again.');
    expect(stopFailedWords([
      { goal: 'Plan the trip', reason: 'your Pond is busy' },
      { goal: 'Find a plumber', reason: 'your Pond no longer has it' },
    ])).toBe('Could not stop Plan the trip: your Pond is busy; Find a plumber: your Pond no longer has it. Try again.');
  });
});
