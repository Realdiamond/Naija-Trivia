/**
 * "Watch a short ad" (mockup 25, step 2.4c): a rewarded video, only when the player chooses and
 * never during a question. The coins come from AdMob's callback to our server, so the wallet is
 * looked at again for a few seconds afterwards. Phones only; nothing shows on the web.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { adsAvailable, showRewarded } from '../../ads';
import { trackEvent } from '../../analytics';
import { useSession } from '../../auth/session';
import { useT } from '../../i18n';
import { useFlag } from '../liveops/config';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';
import { useRewardedStatus, walletKeys } from './api';

export function WatchAdCard({ placement }: { placement: 'coins' | 'shop' }) {
  const t = useT();
  const userId = useSession((s) => s.user?.id);
  const adsOn = useFlag('ads.enabled');
  const rewarded = useRewardedStatus(adsAvailable && adsOn && Boolean(userId));
  const queryClient = useQueryClient();
  const [watching, setWatching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!adsAvailable || !adsOn || !rewarded.data) return null;
  const left = rewarded.data.left_today;

  const watch = async () => {
    if (!userId || watching) return;
    setWatching(true);
    setNote(null);
    trackEvent('ad_requested', { format: 'rewarded', placement });
    const outcome = await showRewarded(userId);
    setWatching(false);
    if (outcome === 'earned') {
      trackEvent('ad_shown', { format: 'rewarded', placement });
      setNote(t('coins.adOnTheWay'));
      // The coins land when AdMob calls our server, usually within seconds.
      for (const ms of [1500, 4000, 9000]) {
        setTimeout(() => void queryClient.invalidateQueries({ queryKey: walletKeys.all }), ms);
      }
    } else if (outcome === 'failed') {
      setNote(t('coins.adFailed'));
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: left === 0, busy: watching }}
      disabled={left === 0 || watching}
      onPress={() => void watch()}
      style={({ pressed }) => [styles.card, left === 0 && styles.off, pressed && styles.pressed]}
      testID="watch-ad"
    >
      <Icon name="play" size={28} color={colors.primaryInk} />
      <View style={styles.grow}>
        <Text variant="heading">{t('coins.watchAd')}</Text>
        <Text variant="caption" color={colors.inkSoft} accessibilityLiveRegion="polite">
          {note ??
            (left === 0 ? t('coins.adsDone') : `${t('coins.adWhen')} · ${t('coins.adsLeft', { n: left })}`)}
        </Text>
      </View>
      <Text variant="heading" color={colors.primaryInk}>
        +{rewarded.data.coins}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primaryTint,
  },
  grow: { flex: 1, gap: 2 },
  off: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
});
