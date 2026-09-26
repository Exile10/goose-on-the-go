/**
 * MemoriesScreen — Categorized memory cards with icons, pin, and delete.
 *
 * Category filter tabs, memory cards with visual indicators.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
} from 'react-native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { SAMPLE_MEMORIES, type MemoryFragment, type MemoryCategory } from '@/models/memory';
import { Grey, JaridaPurple, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

const CATEGORY_TABS: (MemoryCategory | 'All')[] = ['All', 'Preference', 'Habit', 'Person', 'Reminder'];

const CATEGORY_COLORS: Record<MemoryCategory, string> = {
  Preference: JaridaPurple[500],
  Habit: Semantic.info,
  Person: Semantic.success,
  Reminder: Semantic.warning,
};

/** Memory card */
const MemoryCard = React.memo(function MemoryCard({
  item,
  onPin,
  onDelete,
}: {
  item: MemoryFragment;
  onPin: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const catColor = CATEGORY_COLORS[item.category];
  return (
    <View style={styles.memoryCard}>
      <View style={styles.memoryHeader}>
        <View style={{ marginRight: Spacing.sm }}>
          <GIcon name={item.icon} size={16} color={catColor} />
        </View>
        <View style={[styles.categoryBadge, { backgroundColor: catColor + '18' }]}>
          <Text style={[styles.categoryText, { color: catColor }]}>{item.category}</Text>
        </View>
        <View style={styles.memoryActions}>
          <GPressable onPress={() => onPin(item.id)} style={styles.actionBtn}>
            <GIcon name={item.pinned ? 'check' : 'logs'} size={14} color={item.pinned ? JaridaPurple[500] : Grey[400]} />
          </GPressable>
          <GPressable onPress={() => onDelete(item.id)} style={styles.actionBtn}>
            <GIcon name="trash" size={14} color={Grey[400]} />
          </GPressable>
        </View>
      </View>
      <Text style={styles.memoryText}>{item.text}</Text>
      <Text style={styles.memoryTime}>{item.time}</Text>
    </View>
  );
});

export default function MemoriesScreen() {
  const styles = useThemedStyles(makeStyles);
  const [memories, setMemories] = useState(SAMPLE_MEMORIES);
  const [activeCategory, setActiveCategory] = useState<MemoryCategory | 'All'>('All');

  const filtered = activeCategory === 'All'
    ? memories
    : memories.filter((m) => m.category === activeCategory);

  const handlePin = useCallback((id: number) => {
    setMemories((prev) =>
      prev.map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m)),
    );
  }, []);

  const handleDelete = useCallback((id: number) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: MemoryFragment }) => (
      <MemoryCard item={item} onPin={handlePin} onDelete={handleDelete} />
    ),
    [handlePin, handleDelete],
  );

  const keyExtractor = useCallback((item: MemoryFragment) => String(item.id), []);

  return (
    <View style={styles.container}>
      {/* Category tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsRow}
      >
        {CATEGORY_TABS.map((tab) => (
          <GPressable feedback="lift"
            key={tab}
            style={[styles.tab, activeCategory === tab && styles.tabActive]}
            onPress={() => setActiveCategory(tab)}
          >
            <Text style={[styles.tabText, activeCategory === tab && styles.tabTextActive]}>
              {tab}
            </Text>
          </GPressable>
        ))}
      </ScrollView>

      {/* Memory list */}
      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },

    /* Tabs */
    // Pins this ScrollView's own height to its content instead of letting it
    // compete for leftover flex space with the list below — without this,
    // filtering to a category with fewer results frees up vertical space
    // that gets redistributed into the tab pills instead of staying blank,
    // stretching them tall.
    tabsScroll: {
      flexGrow: 0,
      flexShrink: 0,
    },
    tabsRow: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      gap: Spacing.sm,
      backgroundColor: c.card,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    tab: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: 8,
      borderRadius: Radii.pill,
      backgroundColor: c.backgroundSecondary,
    },
    tabActive: { backgroundColor: JaridaPurple[500] },
    tabText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: c.textTertiary,
    },
    tabTextActive: { color: Brand.white },

    /* List */
    listContent: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      paddingBottom: Spacing['3xl'],
    },

    /* Memory card */
    memoryCard: {
      backgroundColor: c.card,
      borderRadius: Radii.xl,
      padding: Spacing.lg,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: Spacing.md,
    },
    memoryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    categoryBadge: {
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: Radii.pill,
    },
    categoryText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.bold,
    },
    memoryActions: {
      flexDirection: 'row',
      marginLeft: 'auto',
      gap: Spacing.sm,
    },
    actionBtn: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    memoryText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.base,
      color: c.text,
      lineHeight: FontSize.base * 1.5,
    },
    memoryTime: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.xs,
      color: Grey[400],
      marginTop: Spacing.sm,
    },
  });
