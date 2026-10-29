/**
 * Practice packs (GDD §2.6, build plan step 2.8g): the packs a player can practise, unlocked or
 * for coins, and which are saved on this device. Offline, only the saved ones show, and they play.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { PackSummary } from '@whosabi/shared-types';
import { errorMessage } from '../../api';
import { useSession } from '../../auth/session';
import { useWallet, walletKeys } from '../../features/economy/api';
import { practice, practiceKeys, usePacks } from '../../features/practice/api';
import { loadPractice, sendQueued, usePractice } from '../../features/practice/store';
import { useT } from '../../i18n';
import { Dialog } from '../../ui/Dialog';
import { CategoryDot } from '../../ui/game';
import { Icon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

export default function Practice() {
  const t = useT();
  const status = useSession((s) => s.status);
  const online = status === 'guest' || status === 'account';
  const loaded = usePractice((s) => s.loaded);
  const saved = usePractice((s) => s.packs);
  const packs = usePacks(online);
  const wallet = useWallet(online);
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<PackSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadPractice();
  }, []);
  // Games played offline go as soon as the player is back.
  useEffect(() => {
    if (online) void sendQueued();
  }, [online]);

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  const offline = !online || packs.isError;
  const list = offline ? Object.values(saved).map((s) => s.pack) : (packs.data?.packs ?? []);
  const waiting = !loaded || (online && packs.isLoading);

  const open = (pack: PackSummary) => {
    setError(null);
    if (pack.unlocked || saved[pack.id]) {
      router.push(`/practice/${pack.id}`);
      return;
    }
    if (pack.access !== 'coins' || pack.price_coins === null) return;
    const coins = wallet.data?.coins ?? 0;
    if (coins < pack.price_coins) {
      setError(t('practice.notEnough', { coins: pack.price_coins }));
      return;
    }
    setAsking(pack);
  };

  const unlock = async (pack: PackSummary) => {
    setAsking(null);
    try {
      await practice.unlock(pack.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: practiceKeys.packs }),
        queryClient.invalidateQueries({ queryKey: walletKeys.all }),
      ]);
      router.push(`/practice/${pack.id}`);
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
    }
  };

  return (
    <Screen back backTo="/home">
      <Text variant="title" accessibilityRole="header">
        {t('practice.title')}
      </Text>
      <Text variant="bodySoft" style={styles.intro}>
        {offline ? t('practice.offline') : t('practice.intro')}
      </Text>
      {error ? (
        <Text variant="body" color={colors.wrongInk} style={styles.error} testID="practice-error">
          {error}
        </Text>
      ) : null}
      {waiting ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} size="large" />
      ) : list.length === 0 ? (
        <Text variant="bodySoft" align="center" style={styles.loading}>
          {offline ? t('practice.noneSaved') : t('practice.empty')}
        </Text>
      ) : (
        <View style={styles.list}>
          {list.map((pack) => (
            <PackCard key={pack.id} pack={pack} saved={Boolean(saved[pack.id])} onPress={() => open(pack)} />
          ))}
        </View>
      )}
      <Dialog
        visible={asking !== null}
        title={t('practice.unlockTitle', { title: asking?.title ?? '' })}
        body={t('practice.unlockBody', {
          coins: asking?.price_coins ?? 0,
          balance: (wallet.data?.coins ?? 0).toLocaleString('en-NG'),
        })}
        confirmLabel={t('practice.unlockConfirm')}
        cancelLabel={t('practice.cancel')}
        onConfirm={() => asking && void unlock(asking)}
        onCancel={() => setAsking(null)}
        testID="unlock-dialog"
      />
    </Screen>
  );
}

function PackCard({ pack, saved, onPress }: { pack: PackSummary; saved: boolean; onPress: () => void }) {
  const t = useT();
  const playable = pack.unlocked || saved;
  const locked = !playable && pack.access === 'pass';
  const note = playable
    ? null
    : pack.access === 'coins'
      ? t('practice.unlock', { coins: pack.price_coins ?? 0 })
      : t('practice.pass');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={note ? `${pack.title} (${note})` : pack.title}
      accessibilityState={{ disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={({ pressed }) => [styles.card, locked && styles.locked, pressed && styles.pressed]}
      testID={`pack-${pack.slug}`}
    >
      <CategoryDot id={pack.category_id ?? 'mixed'} size={14} />
      <View style={styles.cardText}>
        <Text variant="label">{pack.title}</Text>
        {pack.description ? <Text variant="caption">{pack.description}</Text> : null}
        <Text variant="caption" color={colors.inkSoft}>
          {t('practice.questions', { n: pack.questions })}
          {saved ? ` · ${t('practice.saved')}` : ''}
        </Text>
        {note ? (
          <Text variant="caption" color={colors.primaryInk} testID={`pack-${pack.slug}-locked`}>
            {note}
          </Text>
        ) : null}
      </View>
      <Icon name={playable ? 'play' : 'coin'} size={24} color={colors.primaryInk} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: 4, marginBottom: 12 },
  error: { marginBottom: 12 },
  loading: { marginTop: 40 },
  list: { gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardText: { flex: 1, gap: 2 },
  locked: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
});
