/**
 * BiometricsScreen — Face Recognition + Voice Recognition setup
 * with enrollment flows.
 */

import React, { useState } from 'react';
import { InkButton, InkSwitch, InkIcon } from '@jarida/ink/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';

import { Grey, JaridaPurple, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';
import i18n from '@/services/i18n';


type EnrollState = 'not_enrolled' | 'enrolling' | 'enrolled';

interface BiometricMethod {
  id: string;
  title: string;
  description: string;
  icon: string;
  state: EnrollState;
  enabled: boolean;
}

export default function BiometricsScreen() {
  const [methods, setMethods] = useState<BiometricMethod[]>([
    {
      id: 'face',
      title: i18n.t('biometricsMethods.faceTitle'),
      description: i18n.t('biometricsMethods.faceDesc'),
      icon: 'face',
      state: 'enrolled',
      enabled: true,
    },
    {
      id: 'voice',
      title: i18n.t('biometricsMethods.voiceTitle'),
      description: i18n.t('biometricsMethods.voiceDesc'),
      icon: 'mic',
      state: 'not_enrolled',
      enabled: false,
    },
  ]);

  const toggleMethod = (id: string) => {
    setMethods((prev) =>
      prev.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)),
    );
  };

  const startEnrollment = (id: string) => {
    setMethods((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, state: 'enrolling' } : m,
      ),
    );
    // Simulate enrollment completing after 2s
    setTimeout(() => {
      setMethods((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, state: 'enrolled', enabled: true } : m,
        ),
      );
    }, 2000);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {/* Info banner */}
      <View style={styles.infoBanner}>
        <InkIcon name="shield" size={18} tone="brand" />
        <Text style={styles.infoText}>{i18n.t('biometrics.info')}</Text>
      </View>

      {/* Biometric methods */}
      <Text style={styles.sectionLabel}>{i18n.t('biometrics.methods')}</Text>
      {methods.map((method) => (
        <View key={method.id} style={styles.methodCard}>
          <View style={styles.methodHeader}>
            <View style={{ marginRight: Spacing.md }}>
              <InkIcon name={method.icon} size={28} tone="brand" />
            </View>
            <View style={styles.methodInfo}>
              <Text style={styles.methodTitle}>{method.title}</Text>
              <Text style={styles.methodDesc}>{method.description}</Text>
            </View>
            <InkSwitch
              checked={method.enabled}
              onChange={() => toggleMethod(method.id)}
            />
          </View>

          {/* Enrollment status */}
          <View style={styles.enrollSection}>
            {method.state === 'enrolled' ? (
              <View style={styles.enrolledRow}>
                <View style={[styles.statusBadge, { backgroundColor: Semantic.successSoft }]}>
                  <Text style={[styles.statusText, { color: Semantic.success }]}>{i18n.t('biometrics.enrolled')}</Text>
                </View>
                <Pressable style={styles.reEnrollBtn}>
                  <InkIcon name="refresh" size={14} tone="brand" />
                  <Text style={styles.reEnrollText}>{i18n.t('biometrics.reEnroll')}</Text>
                </Pressable>
              </View>
            ) : method.state === 'enrolling' ? (
              <View style={styles.enrollingRow}>
                <View style={styles.progressBar}>
                  <View style={styles.progressFill} />
                </View>
                <Text style={styles.enrollingText}>{i18n.t('biometrics.enrolling')}</Text>
              </View>
            ) : (
              <InkButton
                variant="quiet"
                onPress={() => startEnrollment(method.id)}
              >
                {i18n.t('biometrics.startEnrollment')}
              </InkButton>
            )}
          </View>

          {/* Enrollment steps hint */}
          {method.state === 'not_enrolled' && (
            <View style={styles.stepsHint}>
              <Text style={styles.stepsTitle}>{i18n.t('biometrics.setupRequires')}</Text>
              {method.id === 'face' ? (
                <>
                  <Text style={styles.stepItem}>{'\u2022'} {i18n.t('biometrics.faceCamera')}</Text>
                  <Text style={styles.stepItem}>{'\u2022'} {i18n.t('biometrics.turnHead')}</Text>
                  <Text style={styles.stepItem}>{'\u2022'} {i18n.t('biometrics.faceDuration')}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.stepItem}>{'\u2022'} {i18n.t('biometrics.readPhrases')}</Text>
                  <Text style={styles.stepItem}>{'\u2022'} {i18n.t('biometrics.normalVoice')}</Text>
                  <Text style={styles.stepItem}>{'\u2022'} {i18n.t('biometrics.voiceDuration')}</Text>
                </>
              )}
            </View>
          )}
        </View>
      ))}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Grey[50] },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

  /* Info banner */
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: JaridaPurple[50],
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  infoText: {
    flex: 1,
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: JaridaPurple[700],
    lineHeight: FontSize.sm * 1.5,
  },

  sectionLabel: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    fontWeight: FontWeight.bold,
    color: Grey[500],
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.md,
  },

  /* Method card */
  methodCard: {
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Grey[200],
    marginBottom: Spacing.md,
  },
  methodHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  methodInfo: { flex: 1, marginRight: Spacing.sm },
  methodTitle: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Brand.charcoal,
  },
  methodDesc: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
    lineHeight: FontSize.sm * 1.5,
    marginTop: 4,
  },

  /* Enrollment section */
  enrollSection: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Grey[100],
  },
  enrolledRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusBadge: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  statusText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  reEnrollBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  reEnrollText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: JaridaPurple[500],
  },

  /* Enrolling */
  enrollingRow: { gap: Spacing.sm },
  progressBar: {
    height: 6,
    backgroundColor: Grey[200],
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    width: '60%',
    height: '100%',
    backgroundColor: JaridaPurple[500],
    borderRadius: 3,
  },
  enrollingText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: JaridaPurple[600],
    fontWeight: FontWeight.medium,
  },

  /* Steps hint */
  stepsHint: {
    marginTop: Spacing.md,
    backgroundColor: Grey[50],
    borderRadius: Radii.lg,
    padding: Spacing.md,
  },
  stepsTitle: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Grey[600],
    marginBottom: Spacing.xs,
  },
  stepItem: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
    lineHeight: FontSize.sm * 1.7,
  },
});
