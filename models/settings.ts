/** Settings types */

export interface IdentitySettings {
  userName: string;
  assistantName: string;
  timezone: string;
  personality: string;
  personalityPreset: 'friendly' | 'professional' | 'playful' | 'terse';
}

export interface VoiceSettings {
  shortcut: string;
  wakePhrase: string;
  maxListenTime: number;
  vadEnabled: boolean;
  inputDevice: string;
  calibrated: boolean;
}

export interface ModelSettings {
  conversationModel: string;
  reasoningModel: string;
  taskModel: string;
  creativity: number;
  responseLength: number;
  streamResponses: boolean;
}

export interface LocationSettings {
  weatherEnabled: boolean;
  locationName: string;
  latitude: number;
  longitude: number;
}

export interface AgentSettings {
  thoroughness: 'smart' | 'chat' | 'proactive';
  maxSteps: number;
  memoryEnabled: boolean;
  recallCount: number;
}

export interface DataSettings {
  eventLogDays: number;
  sensorReadingDays: number;
  sessionMessages: number;
  serverUrl: string;
  launchOnStartup: boolean;
  telemetry: boolean;
}

export interface AppSettings {
  identity: IdentitySettings;
  voice: VoiceSettings;
  models: ModelSettings;
  location: LocationSettings;
  agent: AgentSettings;
  data: DataSettings;
}
