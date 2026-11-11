/**
 * Connectors: everything the Pond can connect to, by kind, with how each stands, and a webhook for
 * anything else that can send a web request. A connector the Pond adds later shows up here, set up
 * from the fields it names.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { InkButton, InkCard, InkInput, InkSpinner, InkText, useInkTheme } from '@/components/ui/ink';

import { openConnector } from '@/components/goose/connector-strip';
import { GroupHeading, GroupRow, InsetGroup } from '@/components/goose/following';
import { ScreenScroll, SectionHead } from '@/components/goose/hub-parts';
import { Labelled } from '@/components/goose/labelled';
import { ContentUnavailable } from '@/components/patterns/content-unavailable';
import { GIcon } from '@/components/ui/g-icon';
import { iconOr } from '@/constants/icons';
import { Spacing } from '@/constants/spacing';
import { categoryIcon, categoryKey, connectorsByCategory, statusKey } from '@/models/connectors';
import { isUnavailable } from '@/models/content-state';
import { copyText } from '@/services/clipboard';
import { confirm } from '@/services/haptics';
import { showSnackbar } from '@/services/snackbar';
import { useConnectors } from '@/view-models/use-connectors';
import { useContentState } from '@/view-models/use-content-state';
import { usePullToRefresh } from '@/view-models/use-pull-to-refresh';

function MakeWebhook({ onMake, busy }: { onMake: (name: string) => Promise<{ webhookUrl: string | null; name: string } | null>; busy: boolean }) {
  const { t } = useTranslation();
  const theme = useInkTheme();
  const [name, setName] = useState('');
  const [made, setMade] = useState<{ url: string; name: string } | null>(null);
  if (made) {
    return (
      <InkCard>
        <InkText size="lg" weight="bold">
          {t('goose.webhook.madeTitle', { name: made.name })}
        </InkText>
        <InkText tone="secondary">{t('goose.webhook.onlyOnce')}</InkText>
        <View style={[styles.url, { backgroundColor: theme.color.content, borderColor: theme.color.lineStrong }]}>
          <InkText mono size="sm" style={{ flex: 1 }}>
            {made.url}
          </InkText>
        </View>
        <View style={styles.row}>
          <InkButton
            variant="primary"
            icon="copy"
            onPress={async () => {
              const done = await copyText(made.url);
              if (done === 'copied') {
                void confirm();
                showSnackbar({ message: t('goose.webhook.copied'), tone: 'success' });
              }
            }}
          >
            {t('goose.webhook.copy')}
          </InkButton>
          <InkButton variant="quiet" onPress={() => setMade(null)}>
            {t('goose.webhook.done')}
          </InkButton>
        </View>
      </InkCard>
    );
  }
  return (
    <InkCard>
      <View style={styles.titleRow}>
        <GIcon name="webhook" size={20} color={theme.color.accentLine} />
        <InkText size="lg" weight="bold">
          {t('goose.webhook.title')}
        </InkText>
      </View>
      <InkText tone="secondary">{t('goose.webhook.body')}</InkText>
      <Labelled label={t('goose.webhook.name')}>
        <InkInput label={t('goose.webhook.name')} value={name} onChange={setName} placeholder={t('goose.webhook.namePlaceholder')} />
      </Labelled>
      <InkButton
        variant="primary"
        icon="plus"
        loading={busy}
        disabled={!name.trim()}
        onPress={async () => {
          const c = await onMake(name);
          if (c?.webhookUrl) {
            setMade({ url: c.webhookUrl, name: c.name });
            setName('');
          }
        }}
        style={styles.left}
      >
        {t('goose.webhook.make')}
      </InkButton>
    </InkCard>
  );
}

export default function GooseConnectorsScreen() {
  const { t } = useTranslation();
  const connectors = useConnectors();
  const pull = usePullToRefresh(connectors.reload);
  const groups = connectorsByCategory(connectors.data);
  const state = useContentState({ loading: connectors.loading, failed: connectors.failed, hasContent: connectors.data.length > 0 });
  return (
    <ScreenScroll pull={pull}>
      <SectionHead title={t('goose.connectors.screenTitle')} subtitle={t('goose.connectors.screenSubtitle')} />
      {state === 'loading' ? <InkSpinner label={t('goose.connectors.loading')} /> : null}
      {isUnavailable(state) ? <ContentUnavailable state={state} reason={connectors.error} onRetry={connectors.reload} /> : null}
      {groups.map((group) => (
        <View key={group.category} style={styles.group}>
          <GroupHeading title={t(categoryKey(group.category))} />
          <InsetGroup>
            {group.connectors.map((c, i) => (
              <GroupRow
                key={c.id}
                first={i === 0}
                icon={iconOr(c.icon, categoryIcon(c.category))}
                label={c.name}
                detail={c.status === 'error' ? (c.statusDetail ?? t(statusKey(c.status))) : c.summary}
                value={c.status === 'connected' ? null : t(statusKey(c.status))}
                onPress={() => openConnector(c.id)}
              />
            ))}
          </InsetGroup>
        </View>
      ))}
      {!connectors.loading ? <MakeWebhook busy={connectors.busy === 'webhook'} onMake={(name) => connectors.actions.makeWebhook(name)} /> : null}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  group: { gap: Spacing.xs },
  url: { padding: Spacing.md, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', gap: Spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  left: { alignSelf: 'flex-start' },
});
