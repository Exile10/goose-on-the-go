/**
 * The four destinations, drawn by Ink's bottom bar — and the bar contracting.
 *
 * The bar is positioned over the screens rather than beside them. React
 * Navigation renders a custom `tabBar` as a flex sibling in a column, so it
 * reserves its own strip and content stops above it. A bar that reserves a
 * strip cannot contract out of one: the list would reflow under a moving
 * thumb. Lifted out of flow it can, and lists clear it with their own bottom
 * padding instead — `useBottomBarInset`.
 *
 * Which stage it is in comes from whichever list the reader is scrolling; see
 * `providers/chrome-provider`. The last stage is Ink's own: the bar shrinks to
 * a single control carrying the current destination's glyph, and pressing that
 * restores the bar rather than navigating, because the reader contracted it by
 * scrolling and not by choosing to.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  InkBottomBar,
  InkProvider,
  useInkTheme,
  type InkNavDestination,
} from '@jarida/ink/native';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GIcon } from '@/components/ui/g-icon';
import {
  ChromeProvider,
  useChromeMeasure,
  useChromeRestore,
  useChromeStage,
} from '@/providers/chrome-provider';
import { useOnboarding } from '@/view-models/use-onboarding';
import { selectionTick } from '@/services/haptics';
import type { IconName } from '@/constants/icons';
import type { TranslationKey } from '@/services/i18n';

const DESTINATIONS: { name: string; labelKey: TranslationKey; icon: IconName }[] = [
  { name: 'index', labelKey: 'tabs.home', icon: 'home' },
  { name: 'chat', labelKey: 'tabs.chat', icon: 'chat' },
  { name: 'devices', labelKey: 'tabs.devices', icon: 'device' },
  { name: 'profile', labelKey: 'tabs.you', icon: 'profile' },
];

interface TabBarProps {
  state: { index: number; routes: { name: string }[] };
  navigation: { navigate: (name: string) => void };
}

function AppTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const theme = useInkTheme();
  const stage = useChromeStage();
  const measure = useChromeMeasure();
  const restore = useChromeRestore();

  const current = state.routes[state.index]?.name ?? 'index';
  const [height, setHeight] = useState(0);

  const items = useMemo<InkNavDestination[]>(
    () =>
      DESTINATIONS.map((d) => ({
        key: d.name,
        label: t(d.labelKey),
        // Ink's own text tokens, because the label beside the icon is already
        // drawn in them — `textOnBrand` is white, which read as selected only
        // for as long as the bar was assumed to be dark.
        icon: (
          <GIcon
            name={d.icon}
            size={22}
            color={d.name === current ? theme.color.text : theme.color.textSecondary}
          />
        ),
      })),
    [current, theme.color.text, theme.color.textSecondary, t],
  );

  // The bar draws a dash over the selected destination in `accentLine`, and
  // exposes no way to turn it off. Selection is already carried by the icon and
  // label going from tertiary to full contrast, so the dash is a third telling
  // of the same fact. A theme scoped to the bar is Ink's own escape hatch, and
  // inside the bar that token draws nothing else.
  const barTheme = useMemo(
    () => ({ ...theme, color: { ...theme.color, accentLine: 'transparent' } }),
    [theme],
  );

  const onChange = useCallback(
    (key: string) => {
      if (key !== current) {
        void selectionTick();
        navigation.navigate(key);
      }
    },
    [current, navigation],
  );

  return (
    // `box-none` so that once the bar is a puck, the width it no longer covers
    // belongs to the content underneath again.
    <View
      pointerEvents="box-none"
      onLayout={(e) => {
        const next = e.nativeEvent.layout.height;
        if (next === height) return;
        setHeight(next);
        measure(next);
      }}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
    >
      <InkProvider theme={barTheme}>
        <InkBottomBar
          label={t('tabs.label')}
          items={items}
          value={current}
          onChange={onChange}
          variant="floating"
          stage={stage}
          collapse
          // Ink would otherwise answer its own puck with local state the stage
          // machine never hears about, and it cannot see a scroll that leaves
          // the stage unchanged — so a reader who pressed and kept scrolling
          // down would hold a bar that never contracted again.
          onExpand={restore}
          // Ink's scroll edge is a top bar's rule: nothing until content has
          // passed under it, because at the top of a page nothing has. At the
          // bottom that inverts — an offset of zero means the bar is over the
          // first screenful — so `auto` spends the whole scroll drawing labels
          // straight onto cards.
          material="always"
          bottomInset={insets.bottom}
          style={{
            // Two placements, one prop. Ink's shell is `alignSelf: flex-end`
            // with a width it only learns from its first layout, so before that
            // layout it has to stretch or it measures its own content and the
            // four destinations bunch into a corner. After it, the width is
            // Ink's animated one, and `flex-end` is what makes the bar contract
            // towards the right rather than the left.
            alignSelf: height > 0 ? 'flex-end' : 'stretch',
            // Glass cannot work on this ground: the derived tint is 0.638 of
            // #1E1B26 and the cards it passes over are also #1E1B26, so it
            // separates nothing, and the 36% it lets through is enough to read
            // a card's white label straight across the bar. Ink names the
            // answer — `chrome`, opaque, not the `surface` content is made of.
            backgroundColor: theme.color.chrome,
            // The lift is a shadow, and a shadow on a dark ground is nothing.
            // An edge is what says this is a plane. The web glass draws the
            // same hairline; the native binding does not.
            borderWidth: theme.edge.hairlineWidth,
            borderColor: theme.color.lineStrong,
          }}
        />
      </InkProvider>
    </View>
  );
}

export default function TabLayout() {
  const onboarding = useOnboarding();
  const { t } = useTranslation();

  if (onboarding.loading) return null;
  if (onboarding.data.show) return <Redirect href="/(onboarding)/welcome" />;

  return (
    <ChromeProvider>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <AppTabBar {...props} />}>
        {DESTINATIONS.map((d) => (
          <Tabs.Screen key={d.name} name={d.name} options={{ title: t(d.labelKey) }} />
        ))}
      </Tabs>
    </ChromeProvider>
  );
}
