/** The Daily on Home (mockup 08): "Daily #142 dey wait · 7 questions · 12-day streak", or done for today. */
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { DailyToday } from '@whosabi/shared-types';
import { useT } from '../../i18n';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

/**
 * `quiet`: something else on Home is the main action (a turn waiting), so the Daily steps back to
 * a light card instead of the solid orange one.
 */
export function DailyBanner({ today, quiet = false }: { today: DailyToday; quiet?: boolean }) {
  const t = useT();
  const done = today.played;
  const subtitle = done
    ? t('daily.bannerDoneSub')
    : [
        today.answered > 0
          ? t('daily.bannerResume', { seq: today.answered + 1 })
          : t('daily.bannerQuestions', { total: today.total }),
        today.streak.current > 0 ? `🔥 ${t('daily.bannerStreak', { days: today.streak.current })}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(done ? `/daily/${today.id}` : '/daily/play')}
      style={({ pressed }) => [
        styles.card,
        quiet && styles.quiet,
        done && styles.done,
        pressed && styles.pressed,
      ]}
      testID="daily-banner"
    >
      <View style={styles.badge}>
        <Icon name="calendar" size={22} color={colors.gold} />
        <Text variant="label" color={colors.white}>
          #{today.id}
        </Text>
      </View>
      <View style={styles.text}>
        <Text variant="heading" color={done ? colors.ink : colors.night}>
          {done ? t('daily.bannerDone', { id: today.id }) : t('daily.bannerTitle', { id: today.id })}
        </Text>
        <Text variant="body" color={done ? colors.inkSoft : colors.night}>
          {subtitle}
        </Text>
      </View>
      <Icon name="chevron-right" size={24} color={colors.night} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: colors.accent,
    marginTop: 8,
  },
  quiet: { backgroundColor: colors.accentTint },
  done: { backgroundColor: colors.primaryTint },
  pressed: { opacity: 0.88 },
  badge: {
    width: 64,
    height: 64,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: colors.night,
  },
  text: { flex: 1, gap: 2 },
});
