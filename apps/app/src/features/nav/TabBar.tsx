/**
 * The tab bar on phones (UX §1, build plan step 2.11): Home, Play, Shop and Profile. Computers
 * get the side navigation instead. Leagues join it in v1.1.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import { useT, type MessageKey } from '../../i18n';
import { Icon, type IconName } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors } from '../../ui/theme';

const TABS: Array<{ path: string; label: MessageKey; icon: IconName }> = [
  { path: '/home', label: 'nav.home', icon: 'home' },
  { path: '/play', label: 'tab.play', icon: 'play' },
  { path: '/shop', label: 'nav.shop', icon: 'bag' },
  { path: '/profile', label: 'nav.profile', icon: 'user' },
];

/** The tab bar shows on the tabs' own screens only; everything else is a page on top. */
export function showsTabBar(pathname: string): boolean {
  return TABS.some((tab) => tab.path === pathname);
}

export function TabBar() {
  const t = useT();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 6) }]} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const active = pathname === tab.path;
        return (
          <Pressable
            key={tab.path}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(tab.label)}
            onPress={() => (active ? undefined : router.replace(tab.path))}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            testID={`tab-${tab.path.slice(1)}`}
          >
            <Icon name={tab.icon} size={24} color={active ? colors.primaryInk : colors.inkSoft} />
            <Text variant="caption" color={active ? colors.primaryInk : colors.inkSoft}>
              {t(tab.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  pressed: { opacity: 0.7 },
});
