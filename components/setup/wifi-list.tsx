/**
 * The networks a Pond can hear, from its own scan; the phone's Wi-Fi is never read. A network opens
 * under its row for its password, and the join and anything the Pond says about it show there too.
 * The password lives in this component while it is typed, and nowhere else.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkBadge, InkButton, InkFormField, InkGroup, InkInput, InkNotice, InkRow, InkSpinner, InkText } from '@jarida/ink/native';

import { GIcon } from '@/components/ui/g-icon';
import { GPressable } from '@/components/ui/g-pressable';
import { Spacing } from '@/constants/spacing';
import { needsPassphrase, passphraseUsable, securityKey } from '@/models/ble-setup';
import { selectionTick } from '@/services/haptics';
import type { TranslationKey } from '@/services/i18n';
import type { WifiNetwork } from '@/services/setup-channel/session';
import type { UsePondWifi } from '@/view-models/use-pond-wifi';
import { SecretField } from './claim-fields';

function signalKey(signal: number): TranslationKey {
  if (signal >= 67) return 'bleSetup.wifi.signalStrong';
  if (signal >= 34) return 'bleSetup.wifi.signalFair';
  return 'bleSetup.wifi.signalWeak';
}

function JoinPanel({
  network,
  wifi,
  hidden,
}: {
  network: WifiNetwork | null;
  wifi: UsePondWifi;
  hidden: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const { phase, failure } = wifi.data;
  const ssid = network?.ssid ?? name.trim();
  const security = network?.security ?? 'wpa2';
  const asks = hidden || (network ? needsPassphrase(network) : true);
  const joining = phase.kind === 'joining' && phase.ssid === ssid;
  const short = asks && passphrase.length > 0 && !passphraseUsable(security, passphrase);
  const ready = !!ssid && (!asks || (hidden ? passphrase.length === 0 || !short : passphrase.length > 0 && !short));
  const join = () => {
    if (!ready || phase.kind !== 'choosing') return;
    wifi.actions.join(ssid, asks ? passphrase : '', hidden);
  };

  if (joining) {
    return (
      <View style={styles.panel} accessibilityLiveRegion="polite">
        <InkSpinner label={t('bleSetup.wifi.joining', { ssid })} />
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      {hidden ? (
        <InkFormField label={t('bleSetup.wifi.otherName')} hint={t('bleSetup.wifi.otherHint')}>
          <InkInput label={t('bleSetup.wifi.otherName')} value={name} onChange={setName} />
        </InkFormField>
      ) : null}
      {asks ? (
        <>
          <InkText size="sm" tone="secondary">{t('bleSetup.wifi.password')}</InkText>
          <SecretField
            label={t('bleSetup.wifi.password')}
            value={passphrase}
            onChange={setPassphrase}
            invalid={short ? t('bleSetup.wifi.passwordShort') : undefined}
            onSubmit={join}
          />
        </>
      ) : null}
      {failure && failure.ssid === ssid ? <InkNotice tone="danger">{failure.message}</InkNotice> : null}
      <InkButton variant="primary" block icon="wifi" disabled={!ready || phase.kind !== 'choosing'} onPress={join}>
        {t('bleSetup.wifi.join')}
      </InkButton>
    </View>
  );
}

export function WifiList({ wifi }: { wifi: UsePondWifi }) {
  const { t } = useTranslation();
  const { networks, phase } = wifi.data;
  // A network's name, or `true` for one that does not show its name.
  const [open, setOpen] = useState<string | true | null>(null);
  const busy = phase.kind !== 'choosing';

  const toggle = (key: string | true) => {
    if (busy) return;
    void selectionTick();
    setOpen((current) => (current === key ? null : key));
  };

  return (
    <InkGroup title={t('bleSetup.wifi.listTitle')}>
      {networks.map((network, i) => {
        const enterprise = network.security === 'enterprise';
        const expanded = open === network.ssid;
        return (
          <View key={network.ssid}>
            <GPressable
              accessibilityRole="button"
              accessibilityState={{ expanded, disabled: enterprise || busy }}
              disabled={enterprise || busy}
              onPress={() => toggle(network.ssid)}
            >
              <InkRow
                divided={i > 0}
                label={
                  <View style={styles.label}>
                    <GIcon name="wifi" size={18} />
                    <InkText>{network.ssid}</InkText>
                  </View>
                }
                description={
                  enterprise
                    ? t('bleSetup.wifi.enterprise')
                    : `${t(securityKey(network.security))} · ${t(signalKey(network.signal))}`
                }
              >
                <View style={styles.trail}>
                  {network.known ? <InkBadge tone="success">{t('bleSetup.wifi.known')}</InkBadge> : null}
                  {network.security !== 'open' ? <GIcon name="lock" size={16} /> : null}
                </View>
              </InkRow>
            </GPressable>
            {expanded ? <JoinPanel network={network} wifi={wifi} hidden={false} /> : null}
          </View>
        );
      })}
      <View>
        <GPressable accessibilityRole="button" accessibilityState={{ expanded: open === true }} disabled={busy} onPress={() => toggle(true)}>
          <InkRow
            divided={networks.length > 0}
            label={
              <View style={styles.label}>
                <GIcon name="plus" size={18} />
                <InkText>{t('bleSetup.wifi.other')}</InkText>
              </View>
            }
          />
        </GPressable>
        {open === true ? <JoinPanel network={null} wifi={wifi} hidden /> : null}
      </View>
    </InkGroup>
  );
}

const styles = StyleSheet.create({
  label: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  trail: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  panel: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
});
