/**
 * MemoryItem — row in the memory list.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { InkIcon } from '@jarida/ink/native';
import { FontFamily, FontSize } from '@/constants/typography';
import { JaridaPurple, Grey } from '@/constants/colors';
import { Spacing } from '@/constants/spacing';

interface MemoryItemProps {
  text: string;
  date: string;
  onDelete: () => void;
}

export const MemoryItem = React.memo(function MemoryItem({ text, date, onDelete }: MemoryItemProps) {
  return (
    <View style={styles.container}>
      <View style={styles.bullet}>
        <InkIcon name="sparkle" size={12} tone="brand" />
      </View>
      <Text style={styles.text} numberOfLines={3}>{text}</Text>
      <Text style={styles.date}>{date}</Text>
      <Pressable onPress={onDelete} hitSlop={8} style={{ padding: 4 }}>
        <InkIcon name="trash" size={14} tone="neutral" />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Grey[100],
  },
  bullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: JaridaPurple[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: '#1C1C1C',
    lineHeight: 20,
  },
  date: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    color: Grey[500],
  },
});
