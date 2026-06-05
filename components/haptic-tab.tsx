import { PlatformPressable } from '@react-navigation/elements';
import * as Haptics from 'expo-haptics';

// expo-router 56 and @react-navigation ship divergent BottomTabBarButtonProps
// definitions; the runtime props are just pressable props, so accept loosely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function HapticTab(props: any) {
  return (
    <PlatformPressable
      {...props}
      onPressIn={(ev) => {
        if (process.env.EXPO_OS === 'ios') {
          // Add a soft haptic feedback when pressing down on the tabs.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        props.onPressIn?.(ev);
      }}
    />
  );
}
