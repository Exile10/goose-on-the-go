/**
 * HelpScreen — a guide to the problems people hit most, each pointing to the screen that fixes it,
 * and a way to write to support. The guide is `constants/help-guide.ts`; the email is `useHelp`.
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { SettingsGroup, SettingsHeader, SettingsRow } from '@/components/settings/settings-list';
import { SettingsScroll } from '@/components/settings/settings-scroll';
import { useSettingsColors } from '@/components/settings/settings-theme';
import { GIcon } from '@/components/ui/g-icon';
import { HELP_TOPICS, type HelpTopic } from '@/constants/help-guide';
import { useHelp } from '@/view-models/use-help';

/** One question; tapping it shows the answer, and a row to the screen that fixes it. */
function TopicRows({ topic, onOpen }: { topic: HelpTopic; onOpen: (route: string) => void }) {
  const { t } = useTranslation();
  const colors = useSettingsColors();
  const [open, setOpen] = useState(false);
  const link = topic.link;
  return (
    <>
      <SettingsRow
        label={t(topic.titleKey)}
        description={open ? t(topic.bodyKey) : null}
        trailing={
          <View style={open ? { transform: [{ rotate: '180deg' }] } : undefined}>
            <GIcon name="chevron" size={16} color={colors.textTertiary} />
          </View>
        }
        accessibilityState={{ selected: open }}
        onPress={() => setOpen(!open)}
      />
      {open && link ? (
        <SettingsRow
          label={t('help.guide.open', { screen: t(link.screenKey) })}
          action
          accessory="next"
          onPress={() => onOpen(link.route)}
        />
      ) : null}
    </>
  );
}

export default function HelpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { supportEmail, mailFailed, actions } = useHelp();
  const open = (route: string) => router.push(route as never);

  return (
    <SettingsScroll>
      <SettingsHeader icon="info" tile="blue" title={t('screens.help')} description={t('help.description')} />
      <SettingsGroup title={t('help.guide.heading')}>
        {HELP_TOPICS.map((topic) => (
          <TopicRows key={topic.id} topic={topic} onOpen={open} />
        ))}
      </SettingsGroup>
      <SettingsGroup
        title={t('help.contact.heading')}
        footer={mailFailed ? t('help.contact.noMail', { email: supportEmail }) : t('help.contact.footer', { email: supportEmail })}
      >
        <SettingsRow
          label={t('help.contact.problem')}
          description={t('help.contact.problemHint')}
          icon="warn"
          tile="red"
          accessory="next"
          onPress={() => void actions.write('problem')}
        />
        <SettingsRow
          label={t('help.contact.feedback')}
          description={t('help.contact.feedbackHint')}
          icon="compose"
          tile="purple"
          accessory="next"
          onPress={() => void actions.write('feedback')}
        />
      </SettingsGroup>
    </SettingsScroll>
  );
}
