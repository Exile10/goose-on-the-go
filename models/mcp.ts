/** MCP App & Server types — Goose On The Go v2 design */

export interface MCPApp {
  id: number;
  name: string;
  category: string;
  icon: string;
  color: string;
  enabled: boolean;
  hasKey: boolean;
  key: string;
}

export interface MCPServer {
  id: number;
  name: string;
  url: string;
  status: 'connected' | 'error' | 'connecting';
  latency: string;
  type: 'official' | 'local' | 'custom';
}

export const INITIAL_APPS: MCPApp[] = [
  { id: 1, name: 'Uber', category: 'Transport', icon: 'device', color: '#000000', enabled: true, hasKey: true, key: 'sk-uber-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' },
  { id: 2, name: 'Glovo', category: 'Food Delivery', icon: 'package', color: '#FFC244', enabled: true, hasKey: true, key: 'glv-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' },
  { id: 3, name: 'Spotify', category: 'Music', icon: 'music', color: '#1DB954', enabled: true, hasKey: true, key: 'sp-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' },
  { id: 4, name: 'Google Calendar', category: 'Productivity', icon: 'calendar', color: '#4285F4', enabled: true, hasKey: false, key: '' },
  { id: 5, name: 'Amazon', category: 'Shopping', icon: 'package', color: '#FF9900', enabled: false, hasKey: true, key: 'amz-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' },
  { id: 6, name: 'Philips Hue', category: 'Smart Home', icon: 'light', color: '#0097FF', enabled: true, hasKey: true, key: 'hue-\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' },
];

export const INITIAL_SERVERS: MCPServer[] = [
  { id: 1, name: 'Jarida Cloud', url: 'mcp.jarida.io', status: 'connected', latency: '12ms', type: 'official' },
  { id: 2, name: 'Local Pond', url: '192.168.1.10:8080', status: 'connected', latency: '2ms', type: 'local' },
  { id: 3, name: 'Dev Server', url: 'dev.myserver.io', status: 'error', latency: '\u2014', type: 'custom' },
];
