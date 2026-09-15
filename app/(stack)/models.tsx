/**
 * AIModelsScreen — the models this Pond actually has, and which one is serving.
 *
 * The cards used to show invented Speed/Quality/Privacy ratings. Nothing in the
 * API produces those numbers, so they have been replaced by facts the server
 * does report: where the model runs, its context window, its size on disk and
 * its quantisation. "Runs on your Pond" is the one privacy claim that can be
 * made honestly, and it is derived from the provider rather than asserted.
 */

import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';

import {
  formatContextWindow,
  formatSize,
  isLocalProvider,
  useModels,
} from '@/view-models/use-models';
import type { ModelEntry } from '@/services/types';
import { Grey, JaridaPurple, Brand, Semantic } from '@/constants/colors';
import { FontFamily, FontSize, FontWeight } from '@/constants/typography';
import { Spacing } from '@/constants/spacing';
import { Radii } from '@/constants/radii';


/** One reported fact about a model. Rendered only when the server sent it. */
function FactRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.ratingRow}>
      <Text style={styles.ratingLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

/** Model card */
const ModelCard = React.memo(function ModelCard({
  model,
  isActive,
  onSelect,
}: {
  model: ModelEntry;
  isActive: boolean;
  onSelect: (model: ModelEntry) => void;
}) {
  const handlePress = useCallback(() => onSelect(model), [model, onSelect]);
  const local = isLocalProvider(model.provider);

  return (
    <Pressable
      style={[styles.modelCard, isActive && styles.modelCardSelected]}
      onPress={handlePress}
      // A model that is not on disk cannot be activated from here; downloading
      // one is the Pond's own job, not the phone's.
      disabled={model.downloaded === false}
    >
      <View style={styles.modelCardHeader}>
        <View>
          <Text style={styles.modelName}>{model.display_name ?? model.name}</Text>
          <Text style={styles.modelProvider}>{model.provider}</Text>
        </View>
        <View
          style={[
            styles.modelBadge,
            { backgroundColor: (local ? Semantic.success : JaridaPurple[500]) + '18' },
          ]}
        >
          <Text
            style={[
              styles.modelBadgeText,
              { color: local ? Semantic.success : JaridaPurple[500] },
            ]}
          >
            {local ? 'On your Pond' : 'Cloud'}
          </Text>
        </View>
      </View>

      {model.description ? <Text style={styles.modelDesc}>{model.description}</Text> : null}

      <View style={styles.ratingsSection}>
        <FactRow label="Context" value={formatContextWindow(model.context_length)} />
        <FactRow label="Size" value={formatSize(model.size_mb)} />
        <FactRow label="Quantisation" value={model.quantization ?? null} />
        <FactRow
          label="Memory"
          value={model.ram_estimate_mb ? `${formatSize(model.ram_estimate_mb)} needed` : null}
        />
      </View>

      {model.downloaded === false ? (
        <Text style={styles.notDownloaded}>Not downloaded on this Pond</Text>
      ) : null}

      {isActive && (
        <View style={styles.selectedIndicator}>
          <Text style={styles.selectedText}>Active</Text>
        </View>
      )}
    </Pressable>
  );
});

export default function AIModelsScreen() {
  const { data, loading, error, actions } = useModels();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      {data.activeModel ? (
        <View style={styles.contextRow}>
          <Text style={styles.contextLabel}>Context Window</Text>
          <Text style={styles.contextValue}>
            {formatContextWindow(data.activeModel.context_length) ?? 'Not reported'}
          </Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>AVAILABLE MODELS</Text>

      {loading ? (
        <View style={styles.stateBlock}>
          <ActivityIndicator color={JaridaPurple[500]} />
        </View>
      ) : null}

      {error ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateError}>{error}</Text>
          <Pressable onPress={actions.refresh} hitSlop={8}>
            <Text style={styles.stateAction}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && !error && data.models.length === 0 ? (
        <View style={styles.stateBlock}>
          <Text style={styles.stateEmpty}>
            This Pond has no models installed yet. Add one from the Pond dashboard.
          </Text>
        </View>
      ) : null}

      {data.models.map((m) => (
        <ModelCard
          key={m.id}
          model={m}
          isActive={m.is_active}
          onSelect={actions.activate}
        />
      ))}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Grey[50] },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

  /* Slider card */

  /* Context window */
  contextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Brand.white,
    borderRadius: Radii.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Grey[200],
    marginBottom: Spacing.xl,
  },
  contextLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[600],
  },
  contextValue: {
    fontFamily: FontFamily.mono,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Brand.charcoal,
  },

  /* Section label */
  sectionLabel: {
    fontFamily: FontFamily.body,
    fontSize: 11,
    fontWeight: FontWeight.bold,
    color: Grey[500],
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.md,
  },

  /* Model card */
  modelCard: {
    backgroundColor: Brand.white,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Grey[200],
    marginBottom: Spacing.md,
  },
  modelCardSelected: {
    borderColor: JaridaPurple[500],
    borderWidth: 2,
  },
  modelCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.sm,
  },
  modelName: {
    fontFamily: FontFamily.heading,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Brand.charcoal,
  },
  modelProvider: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
    marginTop: 2,
  },
  modelBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radii.pill,
  },
  modelBadgeText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
  },
  modelDesc: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[600],
    lineHeight: FontSize.sm * 1.5,
    marginBottom: Spacing.md,
  },

  /* Ratings */
  ratingsSection: { gap: Spacing.sm },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ratingLabel: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    color: Grey[500],
    width: 60,
  },
  factValue: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Grey[700],
  },
  notDownloaded: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.sm,
    color: Grey[500],
    marginTop: Spacing.sm,
  },
  stateBlock: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing['2xl'],
  },
  stateError: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Semantic.danger,
    textAlign: 'center',
  },
  stateAction: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: JaridaPurple[500],
  },
  stateEmpty: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.base,
    color: Grey[500],
    textAlign: 'center',
  },

  /* Selected indicator */
  selectedIndicator: {
    alignSelf: 'flex-start',
    backgroundColor: Semantic.successSoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    marginTop: Spacing.md,
  },
  selectedText: {
    fontFamily: FontFamily.body,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Semantic.success,
  },
});
