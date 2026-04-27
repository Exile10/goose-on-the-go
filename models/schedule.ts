/** Schedule types — Goose On The Go v2 design */

export type EventType = 'routine' | 'calendar' | 'mcp';

export interface ScheduleEvent {
  time: string;
  label: string;
  icon: string;
  type: EventType;
  duration: string;
}

export interface Routine {
  label: string;
  detail: string;
  enabled: boolean;
}

export const SAMPLE_EVENTS: ScheduleEvent[] = [
  { time: '07:00', label: 'Morning routine', icon: 'sun', type: 'routine', duration: '45m' },
  { time: '09:00', label: 'Team standup', icon: 'calendar', type: 'calendar', duration: '30m' },
  { time: '12:30', label: 'Lunch delivery (Glovo)', icon: 'package', type: 'mcp', duration: '\u2014' },
  { time: '18:00', label: 'Evening lights scene', icon: 'light', type: 'routine', duration: 'Ongoing' },
  { time: '21:00', label: 'Night routine', icon: 'moon', type: 'routine', duration: '15m' },
];

export const SAMPLE_ROUTINES: Routine[] = [
  { label: 'Morning', detail: 'Weekdays \u00B7 7:00 AM', enabled: true },
  { label: 'Evening', detail: 'Daily \u00B7 6:00 PM', enabled: true },
  { label: 'Night', detail: 'Daily \u00B7 9:00 PM', enabled: true },
  { label: 'Weekend lazy', detail: 'Sat\u2013Sun \u00B7 9:30 AM', enabled: false },
];
