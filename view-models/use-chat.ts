/**
 * Chat ViewModel
 *
 * Hybrid mock/real, gated by the dev-only `isScreenReal('chat')` toggle (see
 * `providers/server-provider.tsx`). All hooks below are called unconditionally
 * on every render — only the *returned* data/actions branch on the flag, so
 * this stays legal under the Rules of Hooks while still being a real toggle
 * rather than two components.
 *
 * The real path is a thin wrapper over `chat-run-store`'s module-scoped
 * state — the turn itself lives there, outside this hook, so it survives
 * this screen unmounting (tab switch, navigating to Sessions) and the app
 * backgrounding/foregrounding mid-reply. The store wires its own
 * `AppState`-driven resume logic once, at module scope.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Message } from '@/models/chat';
import { useServer } from '@/providers/server-provider';
import { api } from '@/services/api-client';
import {
  abortRun as realAbortRun,
  loadSession as realLoadSession,
  newConversation as realNewConversation,
  send as realSend,
  useChatRun,
} from './chat-run-store';

const SEED_MESSAGES: Message[] = [
  {
    id: '1',
    role: 'assistant',
    content: 'Good morning! I\'ve started your morning routine — lights are warming up, thermostat set to 72°F, and your coffee maker is brewing.',
    timestamp: Date.now() - 300000,
  },
  {
    id: '2',
    role: 'user',
    content: 'Thanks! Can you also check if there are any packages arriving today?',
    timestamp: Date.now() - 240000,
  },
  {
    id: '3',
    role: 'assistant',
    content: 'You have 2 packages expected today:\n\n1. Amazon — arriving by 2 PM\n2. Glovo grocery order — arriving by 4 PM\n\nWant me to send a notification when they\'re nearby?',
    timestamp: Date.now() - 180000,
  },
];

export interface UseChat {
  data: { messages: Message[]; sessionId: string | null; streaming: boolean; activity: string | null };
  loading: boolean;
  error: string | null;
  actions: {
    send: (text: string) => void;
    newConversation: () => void;
    loadSession: (id: string) => void;
    abortRun: () => void;
  };
}

export function useChat(): UseChat {
  const { isScreenReal, serverUrl, token } = useServer();
  const real = isScreenReal('chat');

  // Kept current regardless of mode, so flipping the toggle mid-session
  // never requires a reload before the real path can reach the server.
  useEffect(() => {
    api.setBaseUrl(serverUrl);
    api.setToken(token);
  }, [serverUrl, token]);

  // ── Mock path — unconditionally maintained, only rendered when !real ──
  const [mockMessages, setMockMessages] = useState<Message[]>(() => SEED_MESSAGES);
  const [mockStreaming, setMockStreaming] = useState(false);
  const [mockSessionId] = useState<string | null>('session-1');
  const mockNextId = useRef(4);

  const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const pending = pendingTimeoutsRef.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  const mockSend = useCallback((text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = {
      id: String(mockNextId.current++),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };
    setMockMessages((m) => [...m, userMsg]);
    setMockStreaming(true);

    const timeoutId = setTimeout(() => {
      pendingTimeoutsRef.current.delete(timeoutId);
      const reply: Message = {
        id: String(mockNextId.current++),
        role: 'assistant',
        content: `Working on it. (${text.length} characters received — this is a mock response.)`,
        timestamp: Date.now(),
      };
      setMockMessages((m) => [...m, reply]);
      setMockStreaming(false);
    }, 700);
    pendingTimeoutsRef.current.add(timeoutId);
  }, []);

  const mockNewConversation = useCallback(() => {
    setMockMessages([]);
    mockNextId.current = 1;
  }, []);

  const mockNoop = useCallback(() => {}, []);

  // ── Real path — always subscribed; only rendered when real ──
  const realSnapshot = useChatRun();

  if (real) {
    return {
      data: {
        messages: realSnapshot.messages,
        sessionId: realSnapshot.sessionId,
        streaming: realSnapshot.streaming,
        activity: realSnapshot.activity,
      },
      loading: false,
      error: realSnapshot.error,
      actions: {
        send: realSend,
        newConversation: realNewConversation,
        loadSession: (id: string) => void realLoadSession(id),
        abortRun: realAbortRun,
      },
    };
  }

  return {
    data: { messages: mockMessages, sessionId: mockSessionId, streaming: mockStreaming, activity: null },
    loading: false,
    error: null,
    actions: {
      send: mockSend,
      newConversation: mockNewConversation,
      loadSession: mockNoop,
      abortRun: mockNoop,
    },
  };
}
