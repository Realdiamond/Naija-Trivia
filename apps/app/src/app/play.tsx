/** The Play tab (UX §1): every way to play, one tap each. */
import { Pressable, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSession } from '../auth/session';
import { useFlag } from '../features/liveops/config';
import { useRandomDuel } from '../features/duels/useRandomDuel';
import { useT, type MessageKey } from '../i18n';
import { Icon, type IconName } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, radius } from '../ui/theme';

export default function Play() {
  const t = useT();
  const status = useSession((s) => s.status);
  const random = useRandomDuel();
  const partyOn = useFlag('party.enabled');
  if (status === 'signed_out') return <Redirect href="/welcome" />;

  const modes: Array<{
    key: string;
    icon: IconName;
    title: MessageKey;
    note: MessageKey;
    onPress: () => void;
    off?: boolean;
    busy?: boolean;
  }> = [
    {
      key: 'friend',
      icon: 'swords',
      title: 'play.duelFriend',
      note: 'play.duelFriendNote',
      onPress: () => router.push('/challenge'),
    },
    {
      key: 'random',
      icon: 'shuffle',
      title: 'play.duelRandom',
      note: 'play.duelRandomNote',
      onPress: () => void random.start(),
      busy: random.busy,
    },
    {
      key: 'party',
      icon: 'users',
      title: 'play.party',
      note: 'play.partyNote',
      onPress: () => router.push('/party'),
      off: !partyOn,
    },
    {
      key: 'daily',
      icon: 'calendar',
      title: 'play.daily',
      note: 'play.dailyNote',
      onPress: () => router.push('/daily/play'),
    },
    {
      key: 'practice',
      icon: 'book',
      title: 'play.practice',
      note: 'play.practiceNote',
      onPress: () => router.push('/practice'),
    },
    {
      key: 'leaderboards',
      icon: 'trophy',
      title: 'play.leaderboards',
      note: 'play.leaderboardsNote',
      onPress: () => router.push('/leaderboards'),
    },
  ];

  return (
    <Screen>
      <Text variant="title" accessibilityRole="header" style={styles.title}>
        {t('play.title')}
      </Text>
      <View style={styles.list}>
        {modes.map((mode) => (
          <Pressable
            key={mode.key}
            accessibilityRole="button"
            accessibilityState={{ disabled: mode.off || mode.busy, busy: mode.busy }}
            disabled={mode.off || mode.busy}
            onPress={mode.onPress}
            style={({ pressed }) => [
              styles.card,
              mode.off && styles.off,
              (pressed || mode.busy) && styles.pressed,
            ]}
            testID={`play-${mode.key}`}
          >
            <View style={styles.icon}>
              <Icon name={mode.icon} size={26} color={colors.primaryInk} />
            </View>
            <View style={styles.text}>
              <Text variant="label">{t(mode.title)}</Text>
              <Text variant="caption">{mode.off ? t('home.paused') : t(mode.note)}</Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.inkSoft} />
          </Pressable>
        ))}
      </View>
      {random.error ? (
        <Text variant="body" color={colors.wrongInk} style={styles.error}>
          {random.error}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: 16 },
  list: { gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTint,
  },
  text: { flex: 1, gap: 2 },
  off: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
  error: { marginTop: 12 },
});
