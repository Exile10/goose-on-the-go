/**
 * Ponds near the phone that need this phone: new ones, and someone's that lost their network. The
 * claim for the one picked opens under its own row, and nothing moves to another screen until it works.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkGroup, InkNotice, InkRow, InkSpinner, InkText } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import type { NearbyPond } from '@/models/nearby-pond';
import { readSetupCode } from '@/models/setup-card';
import { selectionTick } from '@/services/haptics';
import type { FindPhase, UseFindPond } from '@/view-models/use-find-pond';
import { DigitsField } from './claim-fields';

function ClaimPanel({ pond, find, onScanCard }: { pond: NearbyPond; find: UseFindPond; onScanCard: () => void }) {
  const { t } = useTranslation();
  const { phase, coolingSecs, spoken, claimedIds } = find.data;
  const claimed = claimedIds.includes(pond.id);
  const credential = phase.kind === 'entering' || phase.kind === 'failed' ? phase.credential : 'setup';
  const [typed, setTyped] = useState('');
  const [typedFor, setTypedFor] = useState(credential);
  // A different kind of code starts an empty field, so card digits never sit in the six-digit one.
  if (typedFor !== credential) {
    setTypedFor(credential);
    setTyped('');
  }

  if (phase.kind === 'claiming' || phase.kind === 'connecting') {
    return (
      <View style={styles.panel} accessibilityLiveRegion="polite">
        <InkSpinner
          label={
            phase.kind === 'connecting'
              ? t('bleSetup.find.connecting', { id: pond.id })
              : phase.resuming
                ? t('bleSetup.find.resuming', { id: pond.id })
                : t('bleSetup.find.claiming', { id: pond.id })
          }
        />
      </View>
    );
  }

  // Someone's Pond that lost its network: its card no longer works, so it says a code instead.
  if (claimed && phase.kind === 'entering' && !phase.spoken) {
    return (
      <View style={styles.panel}>
        {/* The row above already says it needs Wi-Fi; this says what to do about it. */}
        <InkText tone="secondary">{t('bleSetup.find.claimedBody', { id: pond.id })}</InkText>
        {spoken.error ? <InkNotice tone="warning">{spoken.error}</InkNotice> : null}
        <InkButton variant="primary" block icon="volume" disabled={spoken.asking} onPress={find.actions.askSpoken}>
          {spoken.asking ? t('bleSetup.find.askingSpoken') : t('bleSetup.find.askSpoken')}
        </InkButton>
        <View style={styles.alternatives}>
          <InkButton variant="quiet" onPress={find.actions.cancel}>
            {t('bleSetup.find.cancel')}
          </InkButton>
        </View>
      </View>
    );
  }

  const setup = readSetupCode(typed);
  const six = typed.replace(/\D/g, '').slice(0, 6);
  const ready = credential === 'setup' ? setup.status === 'valid' : six.length === 6;
  const code = credential === 'setup' ? setup.digits : six;
  const failure = phase.kind === 'failed'
    ? coolingSecs > 0 ? t('pairingErrors.setupCooling', { count: coolingSecs }) : phase.message
    : null;
  const submit = () => {
    if (ready && coolingSecs === 0) find.actions.submit(code);
  };

  return (
    <View style={styles.panel}>
      {credential === 'setup' ? (
        <>
          <InkText size="sm" tone="secondary">{t('bleSetup.find.codeLabel')}</InkText>
          <DigitsField
            label={t('bleSetup.find.codeLabel')}
            value={setup.display}
            onChange={(next) => setTyped(readSetupCode(next).digits)}
            placeholder={t('pairing.setupCodePlaceholder')}
            invalid={setup.status === 'typo' ? t('pairing.setupCodeTypo') : undefined}
            onSubmit={submit}
          />
          <InkText size="xs" tone="tertiary">{t('bleSetup.find.codeHint')}</InkText>
        </>
      ) : (
        <>
          <InkText size="sm" tone="secondary">{t('bleSetup.find.spokenLabel')}</InkText>
          <DigitsField
            label={t('bleSetup.find.spokenLabel')}
            value={six}
            onChange={(next) => setTyped(next.replace(/\D/g, '').slice(0, 6))}
            placeholder={t('pairing.codePlaceholder')}
            onSubmit={submit}
          />
          <InkText size="xs" tone="tertiary">{t('bleSetup.find.spokenHint')}</InkText>
        </>
      )}
      {failure ? <InkNotice tone="danger">{failure}</InkNotice> : null}
      {spoken.error ? <InkNotice tone="warning">{spoken.error}</InkNotice> : null}
      <InkButton variant="primary" block disabled={!ready || coolingSecs > 0} onPress={submit}>
        {t('bleSetup.find.claim')}
      </InkButton>
      <View style={styles.alternatives}>
        {credential === 'setup' ? (
          <>
            <InkButton variant="quiet" icon="camera" onPress={onScanCard}>
              {t('bleSetup.find.scanCard')}
            </InkButton>
            <InkButton variant="quiet" icon="volume" disabled={spoken.asking} onPress={find.actions.askSpoken}>
              {spoken.asking ? t('bleSetup.find.askingSpoken') : t('bleSetup.find.askSpoken')}
            </InkButton>
          </>
        ) : (
          <>
            <InkButton variant="quiet" icon="volume" disabled={spoken.asking} onPress={find.actions.askSpoken}>
              {spoken.asking ? t('bleSetup.find.askingSpoken') : t('bleSetup.find.askAgain')}
            </InkButton>
            {claimed ? null : (
              <InkButton variant="quiet" icon="key" onPress={find.actions.useCard}>
                {t('bleSetup.find.useCard')}
              </InkButton>
            )}
          </>
        )}
        <InkButton variant="quiet" onPress={find.actions.cancel}>
          {t('bleSetup.find.cancel')}
        </InkButton>
      </View>
    </View>
  );
}

function pickedId(phase: FindPhase): string | null {
  return phase.kind === 'entering' || phase.kind === 'claiming' || phase.kind === 'failed' || phase.kind === 'connecting' ? phase.pondId : null;
}

export function NearbyPonds({ ponds, find, onScanCard }: { ponds: NearbyPond[]; find: UseFindPond; onScanCard: () => void }) {
  const { t } = useTranslation();
  const picked = pickedId(find.data.phase);
  const busy = find.data.phase.kind === 'claiming' || find.data.phase.kind === 'connecting';
  if (ponds.length === 0) return null;
  return (
    <InkGroup title={t('bleSetup.find.newTitle')}>
      {ponds.map((pond, i) => {
        const open = pond.id === picked;
        const claimed = find.data.claimedIds.includes(pond.id);
        const where = claimed
          ? t('bleSetup.find.needsWifi')
          : pond.url
          ? pond.hostname
            ? t('bleSetup.find.onNetworkAt', { host: pond.hostname })
            : t('bleSetup.find.onNetwork')
          : t('bleSetup.find.nearby');
        return (
          <View key={pond.id}>
            <GPressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open, disabled: busy }}
              disabled={busy || open}
              onPress={() => {
                void selectionTick();
                find.actions.pick(pond);
              }}
            >
              <InkRow
                divided={i > 0}
                label={
                  <View style={styles.label}>
                    <GIcon name={pond.url ? 'wifi' : 'bluetooth'} size={18} />
                    <InkText>{t('bleSetup.find.rowName', { id: pond.id })}</InkText>
                  </View>
                }
                description={where}
              >
                {open ? null : (
                  <View style={styles.trail}>
                    {/* Only the network says a Pond is unclaimed before connecting; Bluetooth's name does not. */}
                    {pond.url && !claimed ? <InkBadge tone="brand">{t('onboarding.notSetUp')}</InkBadge> : null}
                    <GIcon name="chevron-right" size={18} />
                  </View>
                )}
              </InkRow>
            </GPressable>
            {open ? <ClaimPanel pond={pond} find={find} onScanCard={onScanCard} /> : null}
          </View>
        );
      })}
    </InkGroup>
  );
}

const styles = StyleSheet.create({
  label: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  trail: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  panel: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
  alternatives: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
});
