/**
 * ScheduleScreen — Day picker and timeline with events and routine toggles.
 */

import { useTranslation } from 'react-i18next';
import React, { useState, useCallback } from 'react';
import { InkSwitch } from '@jarida/ink/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';

import { GPressable } from '@/components/ui/g-pressable';
import { Grey, JaridaPurple, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';

/** Day data for the picker */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DATES = [21, 22, 23, 24, 25, 26, 27];

/** Sample timeline events */
const TIMELINE = [
  { time: '7:00 AM', title: 'Morning Routine', type: 'routine' as const, detail: 'Lights warm up, thermostat to 72°F, coffee maker on', enabled: true },
  { time: '9:00 AM', title: 'Focus Mode', type: 'routine' as const, detail: 'DND enabled, office lights to 80%', enabled: true },
  { time: '12:00 PM', title: 'Lunch Break', type: 'event' as const, detail: 'Calendar: Lunch with Sarah', enabled: false },
  { time: '2:00 PM', title: 'Team Standup', type: 'event' as const, detail: 'Zoom meeting — 30 min', enabled: false },
  { time: '6:00 PM', title: 'Evening Routine', type: 'routine' as const, detail: 'Lights dim, thermostat to 68°F, ambient music', enabled: true },
  { time: '10:00 PM', title: 'Night Mode', type: 'routine' as const, detail: 'All lights off, doors locked, DND on', enabled: true },
];

/** Timeline event row */
const TimelineRow = React.memo(function TimelineRow({
  item,
  index,
  onToggle,
}: {
  item: (typeof TIMELINE)[number];
  index: number;
  onToggle: (index: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const isRoutine = item.type === 'routine';
  return (
    <View style={styles.timelineRow}>
      {/* Time column */}
      <View style={styles.timeCol}>
        <Text style={styles.timeText}>{item.time}</Text>
      </View>

      {/* Timeline line + dot */}
      <View style={styles.lineCol}>
        <View style={[styles.lineDot, isRoutine && styles.lineDotRoutine]} />
        <View style={styles.line} />
      </View>

      {/* Content */}
      <View style={[styles.eventCard, isRoutine && styles.eventCardRoutine]}>
        <View style={styles.eventHeader}>
          <View>
            <Text style={styles.eventTitle}>{item.title}</Text>
            <Text style={styles.eventDetail}>{item.detail}</Text>
          </View>
          {isRoutine && (
            <InkSwitch checked={item.enabled} onChange={() => onToggle(index)} />
          )}
        </View>
        {!isRoutine && (
          <View style={styles.eventBadge}>
            <Text style={styles.eventBadgeText}>{t('schedule.event')}</Text>
          </View>
        )}
      </View>
    </View>
  );
});

export default function ScheduleScreen() {
  const styles = useThemedStyles(makeStyles);
  const [selectedDay, setSelectedDay] = useState(5); // Saturday (index)
  const [events, setEvents] = useState(TIMELINE);

  const handleToggle = useCallback((index: number) => {
    setEvents((prev) =>
      prev.map((e, i) => (i === index ? { ...e, enabled: !e.enabled } : e)),
    );
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* Day picker */}
      <View style={styles.dayPicker}>
        {DAYS.map((day, i) => (
          <GPressable
            feedback="lift"
            key={day}
            style={[styles.dayItem, selectedDay === i && styles.dayItemActive]}
            onPress={() => setSelectedDay(i)}
          >
            <Text style={[styles.dayLabel, selectedDay === i && styles.dayLabelActive]}>
              {day}
            </Text>
            <Text style={[styles.dayDate, selectedDay === i && styles.dayDateActive]}>
              {DATES[i]}
            </Text>
          </GPressable>
        ))}
      </View>

      {/* Timeline */}
      <View style={styles.timeline}>
        {events.map((e, i) => (
          <TimelineRow key={i} item={e} index={i} onToggle={handleToggle} />
        ))}
      </View>

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scroll: { paddingTop: Spacing.md },

  /* Day picker */
  dayPicker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: c.card,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  dayItem: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radii.lg,
  },
  dayItemActive: { backgroundColor: JaridaPurple[500] },
  dayLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: c.textTertiary,
    marginBottom: 4,
  },
  dayLabelActive: { color: JaridaPurple[100] },
  dayDate: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: c.text,
  },
  dayDateActive: { color: Brand.white },

  /* Timeline */
  timeline: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  timelineRow: {
    flexDirection: 'row',
    marginBottom: Spacing.md,
    minHeight: 80,
  },
  timeCol: { width: 62, paddingTop: 4 },
  timeText: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.xs,
    color: c.textTertiary,
  },
  lineCol: {
    width: 24,
    alignItems: 'center',
  },
  lineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Grey[300],
    zIndex: 1,
  },
  lineDotRoutine: { backgroundColor: JaridaPurple[500] },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: c.backgroundSecondary,
  },
  eventCard: {
    flex: 1,
    backgroundColor: c.card,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    marginLeft: Spacing.sm,
    borderWidth: 1,
    borderColor: c.border,
  },
  eventCardRoutine: {
    borderColor: JaridaPurple[200],
    backgroundColor: c.tintSoft,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  eventTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: c.text,
  },
  eventDetail: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: c.textTertiary,
    marginTop: 2,
    maxWidth: 200,
  },
  eventBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Semantic.infoSoft,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radii.pill,
    marginTop: Spacing.sm,
  },
  eventBadgeText: {
    fontFamily: FontFamily.body,
    fontSize: 10,
    fontWeight: FontWeight.bold,
    color: Semantic.info,
  },
});
