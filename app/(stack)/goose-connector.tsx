/**
 * One connector: what it is, how it stands, what it gives Goose (tools, what it can tell Goose has
 * happened, which parts of My Goose it feeds), and how to connect it: a sign-in page for an account,
 * or a form drawn from the fields the Pond names.
 */

import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { InkButton, InkInput, InkNotice, InkSelect, InkSpinner, InkSwitch, InkText, useInkTheme } from '@/components/ui/ink';

import { InsetGroup, GroupRow } from '@/components/goose/following';
import { Labelled } from '@/components/goose/labelled';
import { ScreenScroll, SectionHead } from '@/components/goose/hub-parts';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { DangerQuietButton } from '@/components/pond/danger-quiet-button';
import { GIcon } from '@/components/ui/g-icon';
import { iconOr } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { blankForm, categoryIcon, missingFields, statusKey, type ConnectorField } from '@/models/connectors';
import { isUnavailable } from '@/models/content-state';
import { useConfirm } from '@/providers/confirm-provider';
import { useConnectors } from '@/view-models/use-connectors';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

function Field({ field, value, onChange, missing }: { field: ConnectorField; value: string | boolean; onChange: (v: string | boolean) => void; missing: boolean }) {
  const { t } = useTranslation();
  const label = field.required ? field.label : t('goose.connector.optional', { label: field.label });
  return (
    <View style={styles.field}>
      {field.kind === 'toggle' ? (
        <InkSwitch checked={value === true} onChange={onChange} label={field.label}>
          <InkText weight="semibold">{field.label}</InkText>
        </InkSwitch>
      ) : field.kind === 'select' ? (
        <Labelled label={label} hint={field.help}>
          <InkSelect label={label} value={String(value)} options={field.options.map((o) => ({ value: o, label: o }))} onChange={onChange} />
        </Labelled>
      ) : (
        <Labelled label={label} hint={field.help}>
          <InkInput
            label={label}
            value={String(value)}
            onChange={onChange}
            invalid={missing ? t('goose.connector.required') : undefined}
            type={field.kind === 'secret' ? 'password' : field.kind === 'url' ? 'url' : 'text'}
            inputProps={{ autoCapitalize: 'none', autoCorrect: false }}
          />
        </Labelled>
      )}
    </View>
  );
}

export default function GooseConnectorScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const theme = useInkTheme();
  const { t } = useTranslation();
  const ask = useConfirm();
  const connectors = useConnectors();
  const pull = usePullToRefresh(connectors.reload);
  const c = connectors.data.find((x) => x.id === id) ?? null;
  const state = useContentState({ loading: connectors.loading, failed: connectors.failed, hasContent: !!c });
  // What the member typed, over the form the connector's fields start from.
  const [typed, setValues] = useState<Record<string, string | boolean>>({});
  const [tried, setTried] = useState(false);
  const values = { ...blankForm(c?.setup.fields ?? []), ...typed };
  const missing = c ? missingFields(c.setup.fields, values) : [];
  const busy = connectors.busy === id;
  const { clearFormError } = connectors.actions;
  useEffect(() => clearFormError, [clearFormError]);

  if (!c) {
    return (
      <ScreenScroll pull={pull}>
        {state === 'loading' ? <InkSpinner label={t('goose.connectors.loading')} /> : null}
        {isUnavailable(state) ? <ContentUnavailable state={state} reason={connectors.error} onRetry={connectors.reload} /> : null}
        {state === 'empty' ? <InkText tone="secondary">{t('goose.connector.gone')}</InkText> : null}
      </ScreenScroll>
    );
  }

  const connected = c.status === 'connected';
  const feeds = c.provides.feeds.map((f) => (f === 'news' ? t('goose.connector.feedsNews') : f === 'todos' ? t('goose.connector.feedsTodos') : t('goose.connector.feedsIdeas')));

  return (
    <ScreenScroll pull={pull}>
      <View style={styles.head}>
        <View style={[styles.tile, { backgroundColor: theme.color.accentSoft }]}>
          <GIcon name={iconOr(c.icon, categoryIcon(c.category))} size={30} color={theme.color.accentLine} />
        </View>
        <SectionHead title={c.name} subtitle={c.summary} />
        <InkText size="md" weight="semibold" style={{ color: c.status === 'error' ? theme.color.warningFg : connected ? theme.color.successFg : theme.color.textSecondary }}>
          {[t(statusKey(c.status)), c.statusDetail].filter(Boolean).join('. ')}
        </InkText>
      </View>

      {c.provides.tools || c.provides.events.length || feeds.length ? (
        <View style={styles.section}>
          <SectionHead title={t('goose.connector.gives')} size="small" />
          <InsetGroup>
            {c.provides.tools ? <GroupRow first icon="skills" label={t('goose.connector.tools', { count: c.provides.tools })} /> : null}
            {feeds.length ? <GroupRow first={!c.provides.tools} icon="sparkle" label={t('goose.connector.feeds', { parts: feeds.join(', ') })} /> : null}
            {c.provides.events.map((e, i) => (
              <GroupRow key={e.id} first={!c.provides.tools && !feeds.length && i === 0} icon="bolt" label={e.label} detail={t('goose.connector.eventHint')} />
            ))}
          </InsetGroup>
        </View>
      ) : null}

      {!connected ? (
        <View style={styles.section}>
          <SectionHead title={c.status === 'error' ? t('goose.connector.reconnect') : t('goose.connector.connect')} size="small" />
          {c.setup.oauth ? (
            <>
              <InkText tone="secondary">{t('goose.connector.oauthBody', { name: c.name })}</InkText>
              <InkButton variant="primary" icon="external" onPress={() => void Linking.openURL(c.setup.oauth!)}>
                {t('goose.connector.signIn', { name: c.name })}
              </InkButton>
              <InkButton variant="quiet" icon="refresh" onPress={() => void connectors.reload()}>
                {t('goose.connector.signedIn')}
              </InkButton>
            </>
          ) : null}
          {c.setup.fields.length ? (
            <>
              {c.setup.fields.map((f) => (
                <Field key={f.key} field={f} value={values[f.key] ?? ''} onChange={(v) => setValues((all) => ({ ...all, [f.key]: v }))} missing={tried && missing.includes(f.key)} />
              ))}
              {connectors.formError ? <InkNotice tone="danger">{connectors.formError}</InkNotice> : null}
              <InkButton
                variant="primary"
                icon="plug"
                loading={busy}
                onPress={() => {
                  setTried(true);
                  if (missing.length === 0) void connectors.actions.connect(c.id, values);
                }}
              >
                {t('goose.connector.connectButton', { name: c.name })}
              </InkButton>
            </>
          ) : null}
          {!c.setup.oauth && c.setup.fields.length === 0 ? (
            <InkButton variant="primary" icon="plug" loading={busy} onPress={() => void connectors.actions.connect(c.id, {})}>
              {t('goose.connector.connectButton', { name: c.name })}
            </InkButton>
          ) : null}
        </View>
      ) : (
        <DangerQuietButton
          icon="x"
          disabled={busy}
          onPress={async () => {
            const yes = await ask({ title: t('goose.connector.disconnectTitle', { name: c.name }), message: t('goose.connector.disconnectBody'), confirmLabel: t('goose.connector.disconnect'), destructive: true });
            if (yes) void connectors.actions.disconnect(c.id);
          }}
        >
          {t('goose.connector.disconnect')}
        </DangerQuietButton>
      )}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  head: { gap: Spacing.sm },
  tile: { width: 60, height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  section: { gap: Spacing.md },
  field: { gap: 4 },
});
