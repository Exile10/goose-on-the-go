/** Chat & session types */

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  /** Tool call metadata when role === 'tool' */
  toolName?: string;
  toolStatus?: 'running' | 'ok' | 'error';
}

export interface SessionSummary {
  id: string;
  title: string;
  messageCount: number;
  lastActivity: number;
  modelId: string;
}

export interface ChatState {
  messages: Message[];
  sessionId: string | null;
  streaming: boolean;
}
