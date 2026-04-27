/**
 * Chat ViewModel
 * Manages chat messages, drafting, and mock streaming.
 */

import { useState, useCallback, useRef } from 'react';
import type { Message } from '@/models/chat';

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello there. I see you have provided some system information. How can I help you today? I am here to assist with writing, research, reasoning, planning, coding, or anything else you might need.',
      timestamp: Date.now(),
    },
  ]);
  const [streaming, setStreaming] = useState(false);
  const [sessionId] = useState<string | null>('session-1');
  const nextId = useRef(2);

  const send = useCallback((text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = {
      id: String(nextId.current++),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };
    setMessages((m) => [...m, userMsg]);
    setStreaming(true);

    // Mock response
    setTimeout(() => {
      const reply: Message = {
        id: String(nextId.current++),
        role: 'assistant',
        content: `Working on it. (${text.length} characters received — this is a mock response.)`,
        timestamp: Date.now(),
      };
      setMessages((m) => [...m, reply]);
      setStreaming(false);
    }, 700);
  }, []);

  const newConversation = useCallback(() => {
    setMessages([]);
    nextId.current = 1;
  }, []);

  return {
    data: { messages, sessionId, streaming },
    loading: false,
    error: null as string | null,
    actions: { send, newConversation },
  };
}
