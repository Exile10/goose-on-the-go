/** Log types — Goose On The Go v2 design */

import type { IconName } from '@/constants/icons';

export type LogType = 'action' | 'mcp' | 'system' | 'error';
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  time: string;
  type: LogType;
  icon: IconName;
  text: string;
  level: LogLevel;
}

export const SAMPLE_LOGS: LogEntry[] = [
  { time: '09:18 AM', type: 'action', icon: 'bolt', text: 'Turned on living room lights (Philips Hue)', level: 'info' },
  { time: '09:17 AM', type: 'mcp', icon: 'device', text: 'Uber MCP: requested ride estimate to Airport', level: 'info' },
  { time: '08:52 AM', type: 'system', icon: 'refresh', text: 'Goose model updated to v2.4.1', level: 'info' },
  { time: '08:30 AM', type: 'action', icon: 'thermo', text: 'Set thermostat to 70\u00B0F (scheduled)', level: 'info' },
  { time: '08:01 AM', type: 'error', icon: 'warn', text: 'Glovo MCP: connection timeout (retrying)', level: 'warn' },
  { time: '07:45 AM', type: 'system', icon: 'key', text: 'Biometric auth: Face ID verified', level: 'info' },
  { time: '07:00 AM', type: 'action', icon: 'sun', text: 'Morning routine triggered (7 actions)', level: 'info' },
  { time: 'Yesterday', type: 'error', icon: 'warn', text: 'Dev MCP server unreachable \u2014 skipped', level: 'error' },
];
