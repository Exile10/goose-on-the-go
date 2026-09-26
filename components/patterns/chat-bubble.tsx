/**
 * ChatBubble — message bubble for chat screens.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { JaridaPurple, Grey } from '@/constants/colors';
import { Radii } from '@/constants/radii';
import { Spacing } from '@/constants/spacing';
import i18n from '@/services/i18n';

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
}

export const ChatBubble = React.memo(function ChatBubble({ role, content, loading }: ChatBubbleProps) {
  const isUser = role === 'user';

  return (
    <View style={[styles.container, isUser && styles.containerUser]}>
      <Text style={[styles.author, isUser ? styles.authorUser : styles.authorAssistant]}>
        {isUser ? i18n.t('chat.you') : i18n.t('chat.pond')}
      </Text>
      <View style={[styles.body, isUser ? styles.bodyUser : styles.bodyAssistant]}>
        {loading ? (
          <Text style={styles.dots}>{'\u2022 \u2022 \u2022'}</Text>
        ) : (
          <Text style={styles.text}>{content}</Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  containerUser: {
    alignItems: 'flex-end',
  },
  author: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.12,
    textTransform: 'uppercase',
  },
  authorUser: {
    color: Grey[500],
  },
  authorAssistant: {
    color: JaridaPurple[700],
  },
  body: {
    borderRadius: Radii.md,
    padding: Spacing.md,
    maxWidth: '85%',
  },
  bodyUser: {
    backgroundColor: JaridaPurple[50],
    borderWidth: 1,
    borderColor: JaridaPurple[100],
  },
  bodyAssistant: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Grey[200],
  },
  text: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm + 1.5,
    lineHeight: 21,
    color: '#1C1C1C',
  },
  dots: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.md,
    color: Grey[400],
    letterSpacing: 2,
  },
});
