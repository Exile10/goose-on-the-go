/**
 * VisionEventSheet -- one event in full: the picture large, who or what it was, everything the
 * pond measured, and the two things to do about it: acknowledge it, or make an automation from it.
 *
 * The automation is the same form as everywhere else, prefilled to listen for the same kind of
 * thing, and it opens in this sheet rather than over it: a second modal presented while the first
 * is still on screen is dropped by iOS, and the way back to the event is one tap. The picture and
 * Acknowledge are the two things here that wear the edge.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkEdge, InkNotice, InkSheet, InkText, InkTitle, useInkTheme } from '@jarida/ink/native';

import { AutomationForm } from '@/components/patterns/automation-form-sheet';
import { PondPicture } from '@/components/patterns/pond-picture';
import { SettingsGroup, SettingsRow } from '@/components/settings/settings-list';
import { GSheetBody } from '@/components/ui/g-sheet-body';
import { describeEvent, describeFacts, requestFromEvent, whenOf } from '@/models/vision';
import type { CameraEvent, RuleRequest } from '@/services/types';
import { Spacing } from '@/constants/spacing';

export interface VisionEventSheetProps {
  /** The event to show; the sheet is open while there is one. */
  event: CameraEvent | null;
  nameOf: (profileId: string) => string | null;
  /** An acknowledgement for this event is on its way to the Pond. */
  acknowledging: boolean;
  onClose: () => void;
  onAcknowledge: (event: CameraEvent) => void;
  /** Resolves to why the Pond refused the rule, or null once it exists. */
  onCreateRule: (req: RuleRequest) => Promise<string | null>;
}

export function VisionEventSheet({ event, nameOf, acknowledging, onClose, onAcknowledge, onCreateRule }: VisionEventSheetProps) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const [making, setMaking] = useState(false);
  const [added, setAdded] = useState(false);

  // What the sheet holds belongs to one opening: another event, or none, starts it clean.
  const [shownFor, setShownFor] = useState<number | null>(event?.id ?? null);
  if (shownFor !== (event?.id ?? null)) {
    setShownFor(event?.id ?? null);
    setMaking(false);
    setAdded(false);
  }

  const title = event ? describeEvent(event, nameOf) : '';
  const facts = useMemo(() => (event ? describeFacts(event, nameOf) : []), [event, nameOf]);

  return (
    <InkSheet
      open={event !== null}
      onClose={onClose}
      title={making ? t('schedule.form.automationTitle') : t('visionEvents.sheet.title')}
    >
      {event && making ? (
        <View style={styles.stack}>
          <InkButton variant="quiet" icon="chevron-left" onPress={() => setMaking(false)}>
            {t('visionEvents.sheet.back')}
          </InkButton>
          <AutomationForm
            prefill={requestFromEvent(event, title)}
            onSubmit={onCreateRule}
            onClose={() => {
              setMaking(false);
              setAdded(true);
            }}
          />
        </View>
      ) : null}

      {event && !making ? (
        <GSheetBody maxHeightRatio={0.85}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {event.snapshot_url ? (
              <InkEdge radius={theme.radius.lg} contentStyle={styles.pictureFace}>
                <PondPicture
                  path={event.snapshot_url}
                  version={event.created_at}
                  label={t('visionEvents.sheet.pictureAlt')}
                  contentFit="contain"
                  iconSize={32}
                  style={styles.picture}
                />
              </InkEdge>
            ) : (
              <InkText size="sm" tone="secondary">
                {t('visionEvents.sheet.noPicture')}
              </InkText>
            )}

            <View style={styles.head}>
              <View style={styles.headText}>
                <InkTitle level={3}>{title}</InkTitle>
                <InkText size="sm" tone="tertiary">
                  {whenOf(event)}
                </InkText>
              </View>
              {event.acknowledged ? (
                <InkBadge tone="neutral">{t('visionEvents.acknowledged')}</InkBadge>
              ) : (
                <InkBadge tone="warning">{t('visionEvents.new')}</InkBadge>
              )}
            </View>

            <SettingsGroup>
              {facts.map((fact) => (
                <SettingsRow key={fact.label} label={fact.label} value={fact.value} />
              ))}
            </SettingsGroup>

            {added ? <InkNotice tone="success">{t('visionEvents.sheet.automationAdded')}</InkNotice> : null}

            {event.acknowledged ? null : (
              <InkButton variant="primary" block icon="check" disabled={acknowledging} onPress={() => onAcknowledge(event)}>
                {t('visionEvents.acknowledge')}
              </InkButton>
            )}
            <InkButton variant="quiet" block icon="bolt" onPress={() => setMaking(true)}>
              {t('visionEvents.sheet.makeAutomation')}
            </InkButton>
          </ScrollView>
        </GSheetBody>
      ) : null}
    </InkSheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: Spacing.sm },
  content: { gap: Spacing.lg, paddingBottom: Spacing['2xl'] },
  pictureFace: { overflow: 'hidden' },
  picture: { width: '100%', aspectRatio: 16 / 9 },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  headText: { flex: 1, gap: Spacing.xs },
});
