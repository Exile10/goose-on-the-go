import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { Semantic, type ThemeColors } from '@/constants/colors';
import { insecureDevMode } from '@/services/dev-mode';
import '@/services/i18n';

/**
 * Says, on every screen and for as long as the app runs, that Pond traffic may be plaintext.
 *
 * Shown only in insecure development mode (`services/dev-mode.ts`), and deliberately not
 * dismissable or pressable: the one thing it must never do is let somebody forget that the
 * connection under it can be read and impersonated by anyone on the network. It sits above
 * `ConnectionStatus` in the root layout and takes the top inset, so the strip below it does not
 * add the inset a second time.
 */
export function InsecureDevBanner() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  if (!insecureDevMode) return null;
  return (
    <View accessibilityRole="alert" style={[styles.container, { paddingTop: insets.top + 6 }]}>
      <Text style={styles.title}>{t('devMode.insecureBanner')}</Text>
      <Text style={styles.detail}>{t('devMode.insecureBannerDetail')}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingBottom: 6,
      // The theme surface, not a red fill: this strip is behind the status bar, whose icons
      // follow the scheme (see ConnectionStatus).
      backgroundColor: c.backgroundSecondary,
      borderBottomWidth: 2,
      borderBottomColor: Semantic.danger,
    },
    title: { color: Semantic.danger, fontSize: 12, fontWeight: '700', textAlign: 'center' },
    detail: { color: c.text, fontSize: 11, textAlign: 'center' },
  });
