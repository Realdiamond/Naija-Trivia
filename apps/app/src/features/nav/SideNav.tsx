/** The side navigation on computers (mockup 30, TRD FR-WEB-4); phones get the tab bar (step 2.11). */
import { Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useSession } from '../../auth/session';
import { useT, type MessageKey } from '../../i18n';
import { Icon, type IconName } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, fonts, radius } from '../../ui/theme';

const ITEMS: Array<{ path: string; label: MessageKey; icon: IconName; accountOnly?: boolean }> = [
  { path: '/home', label: 'nav.home', icon: 'home' },
  { path: '/daily/play', label: 'nav.daily', icon: 'calendar' },
  { path: '/challenge', label: 'nav.play', icon: 'play' },
  { path: '/practice', label: 'nav.practice', icon: 'book' },
  { path: '/leaderboards', label: 'nav.leaderboards', icon: 'trophy' },
  { path: '/friends', label: 'nav.friends', icon: 'users', accountOnly: true },
  { path: '/notifications', label: 'nav.notifications', icon: 'bell' },
  { path: '/shop', label: 'nav.shop', icon: 'bag' },
  { path: '/profile', label: 'nav.profile', icon: 'user' },
];

/** Which item a page belongs to: duels under "Start a duel", any Daily page under the Daily. */
function isActive(itemPath: string, pathname: string): boolean {
  if (itemPath === '/challenge') return pathname === itemPath || pathname.startsWith('/duel');
  if (itemPath === '/daily/play') return pathname.startsWith('/daily');
  return pathname === itemPath;
}

export function SideNav() {
  const t = useT();
  const pathname = usePathname();
  const status = useSession((s) => s.status);
  return (
    <View style={styles.nav} accessibilityRole="menu">
      <Text style={styles.brand}>Who Sabi?</Text>
      {ITEMS.filter((item) => !item.accountOnly || status === 'account').map((item) => {
        const active = isActive(item.path, pathname);
        return (
          <Pressable
            key={item.path}
            accessibilityRole="menuitem"
            accessibilityState={{ selected: active }}
            onPress={() => router.navigate(item.path)}
            style={({ pressed }) => [styles.item, active && styles.active, pressed && styles.pressed]}
            testID={`nav-${item.path.slice(1).replace('/', '-')}`}
          >
            <Icon name={item.icon} color={active ? colors.primaryInk : colors.ink} />
            <Text variant="label" color={active ? colors.primaryInk : colors.ink} style={styles.label}>
              {t(item.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Pages that stand alone: the first run, signing in and the duel link landing. */
export function showsSideNav(pathname: string): boolean {
  return (
    !['/', '/welcome', '/taste', '/taste-result', '/sign-in', '/profile-setup'].includes(pathname) &&
    !pathname.startsWith('/d/')
  );
}

const styles = StyleSheet.create({
  nav: {
    width: 260,
    paddingHorizontal: 16,
    paddingTop: 28,
    gap: 6,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: colors.bg,
  },
  brand: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 34,
    color: colors.primaryInk,
    marginBottom: 20,
    marginLeft: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.card,
  },
  active: { backgroundColor: colors.primaryTint },
  pressed: { opacity: 0.8 },
  label: { fontSize: 17 },
});
