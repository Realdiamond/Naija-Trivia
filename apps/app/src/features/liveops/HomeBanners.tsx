/**
 * Home banners and events (build plan step 2.7h): what LiveOps has running, newest first, at
 * most two. Weekend Wahala shows its double XP; a banner with a screen opens it when tapped.
 * Closing one hides it on this device.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { BannerAction, HomeBanner } from '@whosabi/shared-types';
import { useLanguage, useT } from '../../i18n';
import { storage } from '../../platform/storage';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { category, colors, radius } from '../../ui/theme';
import { useRandomDuel } from '../duels/useRandomDuel';
import { useRemoteConfig } from './config';

const CLOSED_KEY = 'home.closedBanners';

const SCREENS: Record<Exclude<BannerAction, 'random'>, string> = {
  daily: '/daily/play',
  party: '/party',
  challenge: '/challenge',
  leaderboards: '/leaderboards',
  shop: '/shop',
  friends: '/friends',
};

export function HomeBanners() {
  const home = useRemoteConfig().data?.home ?? [];
  const [closed, setClosed] = useState<number[] | null>(null);
  useEffect(() => {
    void storage.getItem(CLOSED_KEY).then((raw) => {
      try {
        setClosed(raw ? (JSON.parse(raw) as number[]) : []);
      } catch {
        setClosed([]);
      }
    });
  }, []);
  if (!closed) return null;
  const close = (id: number) => {
    const next = [...closed, id].slice(-50);
    setClosed(next);
    void storage.setItem(CLOSED_KEY, JSON.stringify(next));
  };
  return (
    <>
      {home
        .filter((b) => !closed.includes(b.id))
        .map((b) => (
          <Banner key={b.id} banner={b} onClose={() => close(b.id)} />
        ))}
    </>
  );
}

function Banner({ banner, onClose }: { banner: HomeBanner; onClose: () => void }) {
  const t = useT();
  const pidgin = useLanguage((s) => s.language) === 'pcm';
  const random = useRandomDuel('push');
  const title = (pidgin && banner.title_pcm) || banner.title_en;
  const body = (pidgin && banner.body_pcm) || banner.body_en;
  const boosted = banner.kind === 'double_xp';
  const open = () => {
    if (banner.action === 'random') void random.start();
    else if (banner.action) router.push(SCREENS[banner.action] as Parameters<typeof router.push>[0]);
  };
  return (
    <View style={[styles.card, boosted && styles.boosted]} testID={`home-banner-${banner.id}`}>
      <Pressable
        accessibilityRole={banner.action ? 'button' : undefined}
        disabled={!banner.action || random.busy}
        onPress={open}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        testID={`home-banner-open-${banner.id}`}
      >
        {boosted ? (
          <View style={styles.badge}>
            <Text variant="label" color={colors.white}>
              {t('event.doubleXp')}
            </Text>
          </View>
        ) : null}
        <View style={styles.text}>
          <Text variant="heading">{title}</Text>
          {body ? <Text variant="bodySoft">{body}</Text> : null}
          {boosted ? (
            <Text variant="caption">
              {banner.category_id
                ? t('event.doubleXpOn', { category: category(banner.category_id).name })
                : t('event.doubleXpAll')}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('event.close')}
        hitSlop={12}
        onPress={onClose}
        testID={`home-banner-close-${banner.id}`}
      >
        <Icon name="cross" size={18} color={colors.inkSoft} />
      </Pressable>
    </View>
  );
}

/** Which categories Weekend Wahala doubles XP for right now. */
export function useXpBoosted(): (categoryId: string) => boolean {
  const home = useRemoteConfig().data?.home ?? [];
  return (categoryId) =>
    home.some((b) => b.kind === 'double_xp' && (b.category_id === null || b.category_id === categoryId));
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.accentTint,
  },
  boosted: { backgroundColor: colors.primaryTint },
  main: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pressed: { opacity: 0.8 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  text: { flex: 1, gap: 4 },
});
