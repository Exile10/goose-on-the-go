/**
 * TabLayout — 4-tab bottom navigation via ink's InkBottomBar (issue #18).
 *
 * Uses the packaged `InkBottomBar` component as shipped, unmodified — its own
 * selection treatment (a thin accent line above the icon, label recoloring on
 * selection, icon never tinted by selection) rather than the original bar's
 * purple-pill-behind-white-icon. `InkBottomBar` has no prop to reposition its
 * indicator or to tie the icon's color to selection state, and forking its
 * source to add either would stop this being "ink's primitive" in any real
 * sense — so this satisfies the issue's literal "renders via ink's primitive"
 * criterion under the narrower reading of "visual parity": same floating
 * pill-shaped bar, ink's own per-tab indicator rather than the old one.
 *
 * InkBottomBar has no blurComponent slot and no Reduce Transparency handling
 * of its own (unlike InkNavbar, which has both) — `GlassPill` below supplies
 * both around it, matching exactly what InkNavbar does internally with its
 * own `blurComponent` prop. InkBottomBar renders inside it with `material`
 * off and no margins/radius of its own (`variant="docked"`), so the wrapper
 * owns the floating-pill shape and material, and the bar just lays out items.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { InkBottomBar, useInkTheme, type InkNavDestination } from '@jarida/ink/native';
import { glassSurface, glassLift } from '@jarida/ink';

import { useServer } from '@/providers/server-provider';
import i18n from '@/services/i18n';

import { useHaptics } from '@/hooks/use-haptics';

/** `labelKey` is an i18n key, translated at render. */
const TAB_ITEMS: (Omit<InkNavDestination, 'label'> & { labelKey: string })[] = [
  { key: 'index', labelKey: 'tabs.home', icon: 'home' },
  { key: 'chat', labelKey: 'tabs.chat', icon: 'chat' },
  { key: 'devices', labelKey: 'tabs.devices', icon: 'device' },
  { key: 'profile', labelKey: 'tabs.you', icon: 'profile' },
];

function useReduceTransparency(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceTransparencyEnabled?.().then((v) => {
      if (live) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/**
 * The floating glass pill: real blur, or solid paper when transparency is
 * reduced. The shape (margin/radius/lift) lives on this plain outer View
 * rather than on `BlurView` itself — expo-blur's web shim appends its own
 * `backgroundColor` after whatever `style` it's given, so a color set there
 * would win over the derived tint on web regardless of prop order on our
 * side. Keeping the shape here sidesteps that rather than fighting it; native
 * BlurView doesn't have the issue, but this way both platforms share one path.
 */
function GlassPill({ children, bottomInset }: { children: React.ReactNode; bottomInset: number }) {
  const theme = useInkTheme();
  // Back to ink's own legibility-derived alpha (~0.497 light / ~0.638 dark,
  // no minAlpha floor) — the most transparent the tint can be while the
  // label on it still guarantees 4.5:1 contrast against any backdrop.
  const glass = glassSurface(theme);
  const reduceTransparency = useReduceTransparency();
  const lift = glassLift(theme);

  return (
    <View
      style={[
        styles.pill,
        {
          borderRadius: theme.radius.xl,
          marginHorizontal: theme.space[4],
          marginBottom: Math.max(theme.space[3], bottomInset),
          ...lift,
        },
      ]}
    >
      {reduceTransparency ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: glass.solid }]} />
      ) : (
        <BlurView
          // On native this sets blur strength — the tint color above still
          // wins there. On web, expo-blur's shim computes its own background
          // from these two props and ignores ours entirely (see the file
          // header): intensity 60 on 'light'/'dark' works out to ~0.47 alpha
          // there too, close to the tint's own derived value so neither
          // platform reads more opaque than the other.
          intensity={60}
          tint={theme.scheme === 'dark' ? 'dark' : 'light'}
          style={[StyleSheet.absoluteFill, { backgroundColor: glass.background }]}
        />
      )}
      <View style={styles.bar}>{children}</View>
    </View>
  );
}

// expo-router 56 and @react-navigation ship divergent BottomTabBarProps
// definitions; the runtime props are just { state, descriptors, navigation,
// insets }, so accept loosely rather than fight two incompatible types.
function CustomTabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();

  const handleChange = useCallback(
    (key: string) => {
      const route = state.routes.find((r: { name: string }) => r.name === key);
      if (!route) return;
      const isFocused = state.routes[state.index].key === route.key;
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!isFocused && !event.defaultPrevented) {
        haptics.light();
        navigation.navigate(route.name);
      }
    },
    [state, navigation, haptics],
  );

  return (
    <View style={styles.container}>
      <GlassPill bottomInset={insets.bottom}>
        <InkBottomBar
          label={i18n.t('tabs.navigation')}
          items={TAB_ITEMS.map(({ labelKey, ...item }) => ({ ...item, label: i18n.t(labelKey) }))}
          value={state.routes[state.index].name}
          onChange={handleChange}
          variant="docked"
          material="never"
          style={styles.innerBar}
        />
      </GlassPill>
    </View>
  );
}

export default function TabLayout() {
  const { hydrated, profileId } = useServer();

  // Nothing in this app works without a paired Pond, so an app that has none
  // reaches none of it. A fresh install and a phone that just signed out land
  // in the same place: pairing, and only pairing.
  //
  // Keyed on whether there is a stored identity, not on the connection state.
  // `configure` publishes `unpaired` at the start of every reconfiguration --
  // including the one that enables remote access -- so a guard watching the
  // connection would throw somebody onto the pairing screen in the middle of
  // setting remote access up, which is what the previous attempt did.
  //
  // `hydrated` is what says the stored identity has been read back. Without
  // it, every cold start would bounce through pairing before discovering it is
  // already paired.
  if (hydrated && !profileId) return <Redirect href="/(stack)/pond-pairing" />;

  return (
    <Tabs tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="devices" options={{ title: 'Devices' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  pill: {
    overflow: 'hidden',
  },
  bar: {
    flexDirection: 'row',
  },
  innerBar: {
    width: '100%',
  },
});
