/**
 * PhotoUploadScreen — Drag-drop upload area, analysis states
 * (idle/analysing/done), and Goose suggestions.
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { InkButton, InkTitle } from '@jarida/ink/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Grey, JaridaPurple, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import type { ThemeColors } from '@/constants/colors';


type AnalysisState = 'idle' | 'analysing' | 'done';

interface AnalysisResult {
  label: string;
  confidence: number;
  suggestion: string;
}

const MOCK_RESULTS: AnalysisResult[] = [
  { label: 'Grocery items detected', confidence: 0.94, suggestion: 'Add these to your shopping list: milk, eggs, bread' },
  { label: 'Receipt found', confidence: 0.87, suggestion: 'Total: $42.50 from Trader Joe\'s. Shall I log this expense?' },
  { label: 'Pet detected', confidence: 0.98, suggestion: 'Your golden retriever Max is in the photo! Looking healthy.' },
];

export default function PhotoUploadScreen() {
  const { t } = useTranslation();
  const styles = useThemedStyles(makeStyles);
  const [state, setState] = useState<AnalysisState>('idle');
  const [results, setResults] = useState<AnalysisResult[]>([]);

  const handleUpload = useCallback(() => {
    setState('analysing');
    setTimeout(() => {
      setState('done');
      setResults(MOCK_RESULTS);
    }, 2500);
  }, []);

  const handleReset = useCallback(() => {
    setState('idle');
    setResults([]);
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* Upload area */}
      <GPressable
        feedback="lift"
        style={[styles.uploadArea, state !== 'idle' && styles.uploadAreaDisabled]}
        onPress={state === 'idle' ? handleUpload : undefined}
      >
        {state === 'idle' && (
          <>
            <View style={styles.uploadIconWrap}>
              <GIcon name="upload" size={32} color={JaridaPurple[400]} />
            </View>
            <Text style={styles.uploadTitle}>{t('photo.choose')}</Text>
            <View style={styles.uploadFormats}>
              <Text style={styles.formatText}>{t('photo.formats')}</Text>
            </View>
          </>
        )}

        {state === 'analysing' && (
          <View style={styles.analysingWrap}>
            <GIcon name="search" size={28} color={JaridaPurple[500]} />
            <Text style={styles.analysingTitle}>{t('photo.analysing')}</Text>
            <View style={styles.progressBar}>
              <View style={styles.progressFill} />
            </View>
          </View>
        )}

        {state === 'done' && (
          <View style={styles.doneWrap}>
            <GIcon name="check" size={28} color={Semantic.success} />
            <Text style={styles.doneTitle}>{t('photo.done')}</Text>
          </View>
        )}
      </GPressable>

      {/* Results */}
      {state === 'done' && (
        <>
          <InkTitle level={3}>{t('sections.suggestions')}</InkTitle>
          {results.map((r, i) => (
            <View key={i} style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <Text style={styles.resultLabel}>{r.label}</Text>
                <View style={styles.confidenceBadge}>
                  <Text style={styles.confidenceText}>
                    {Math.round(r.confidence * 100)}%
                  </Text>
                </View>
              </View>
              <Text style={styles.resultSuggestion}>{r.suggestion}</Text>
              <View style={styles.resultActions}>
                <GPressable style={styles.resultAction}>
                  <GIcon name="check" size={14} color={Semantic.success} />
                  <Text style={[styles.resultActionText, { color: Semantic.success }]}>
                    {t('photo.save')}
                  </Text>
                </GPressable>
                <GPressable style={styles.resultAction}>
                  <GIcon name="edit" size={14} color={Grey[500]} />
                  <Text style={styles.resultActionText}>{t('photo.edit')}</Text>
                </GPressable>
              </View>
            </View>
          ))}

          <InkButton variant="quiet" onPress={handleReset}>
            {t('photo.another')}
          </InkButton>
        </>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

    /* Upload area */
    uploadArea: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 240,
      borderRadius: Radii.xl,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: JaridaPurple[200],
      backgroundColor: c.tintSoft,
      padding: Spacing.xl,
      marginBottom: Spacing.xl,
    },
    uploadAreaDisabled: {
      borderStyle: 'solid',
      borderColor: c.border,
      backgroundColor: c.card,
    },
    uploadIconWrap: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.tintSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: Spacing.lg,
    },
    uploadTitle: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.lg,
      fontWeight: FontWeight.bold,
      color: c.text,
      marginBottom: Spacing.sm,
    },
    uploadFormats: {
      backgroundColor: c.backgroundSecondary,
      paddingHorizontal: Spacing.md,
      paddingVertical: 4,
      borderRadius: Radii.pill,
    },
    formatText: {
      fontFamily: FontFamily.mono,
      fontSize: FontSize.xs,
      color: c.textTertiary,
    },

    /* Analysing */
    analysingWrap: { alignItems: 'center', gap: Spacing.md },
    analysingTitle: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.lg,
      fontWeight: FontWeight.bold,
      color: c.textBrand,
    },
    progressBar: {
      width: '80%',
      height: 6,
      backgroundColor: c.backgroundSecondary,
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressFill: {
      width: '65%',
      height: '100%',
      backgroundColor: JaridaPurple[500],
      borderRadius: 3,
    },

    /* Done */
    doneWrap: { alignItems: 'center', gap: Spacing.sm },
    doneTitle: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.lg,
      fontWeight: FontWeight.bold,
      color: Semantic.success,
    },

    /* Result cards */
    resultCard: {
      backgroundColor: c.card,
      borderRadius: Radii.xl,
      padding: Spacing.lg,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: Spacing.md,
    },
    resultHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    resultLabel: {
      fontFamily: FontFamily.heading,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: c.text,
    },
    confidenceBadge: {
      backgroundColor: Semantic.successSoft,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: Radii.pill,
    },
    confidenceText: {
      fontFamily: FontFamily.mono,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.bold,
      color: Semantic.success,
    },
    resultSuggestion: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      color: c.textTertiary,
      lineHeight: FontSize.sm * 1.5,
      marginBottom: Spacing.md,
    },
    resultActions: {
      flexDirection: 'row',
      gap: Spacing.lg,
    },
    resultAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    resultActionText: {
      fontFamily: FontFamily.body,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
      color: c.textTertiary,
    },
  });
