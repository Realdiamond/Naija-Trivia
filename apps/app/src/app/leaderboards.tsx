/**
 * Leaderboards (mockup 22, PRD US-8, TRD §5.5): friends, your state and All Naija, for this
 * week's Daily points (resets Monday) or today's Daily. Guests and 13–17s show without a name.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { routes, type LeaderboardEntry, type LeaderboardScope, type Me } from '@whosabi/shared-types';
import { api, errorMessage } from '../api';
import { useSession } from '../auth/session';
import { useDailyToday, useLeaderboard } from '../features/daily/api';
import { STATE_NAMES } from '../features/profile/states';
import { useT } from '../i18n';
import { Avatar, InitialAvatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, fonts, radius } from '../ui/theme';

type Period = 'week' | 'daily';

export default function Leaderboards() {
  const t = useT();
  const status = useSession((s) => s.status);
  const signedIn = status === 'guest' || status === 'account';
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>(routes.me()), enabled: signedIn });
  // Friends first for accounts (mockup 22); guests have no friends yet.
  const [chosen, setScope] = useState<LeaderboardScope | null>(null);
  const scope = chosen ?? (status === 'account' ? 'friends' : 'global');
  const [period, setPeriod] = useState<Period>('week');
  const today = useDailyToday(signedIn && period === 'daily');
  const board = useLeaderboard(period, scope, period === 'daily' ? today.data?.id : undefined);

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  const homeState = me.data?.home_state ?? null;
  const tabs: Array<{ scope: LeaderboardScope; label: string }> = [
    { scope: 'friends', label: t('lb.friends') },
    { scope: 'state', label: homeState ? STATE_NAMES[homeState] : t('lb.myState') },
    { scope: 'global', label: t('lb.all') },
  ];
  const data = board.data;
  const meBelow = data?.me && !data.entries.some((e) => e.you) ? data.me : null;

  // Guests have no friends to compare with: the tab says how to get some instead.
  const guestFriends = scope === 'friends' && status === 'guest';
  const onlyYou = scope === 'friends' && data?.entries.length === 1 && data.entries[0]!.you;
  const emptyText = () => {
    if (guestFriends) return t('lb.friendsGuest');
    if (scope === 'state' && data?.state === null) return t('lb.noState');
    return data?.me === null ? t('lb.notPlayed') : t('lb.empty');
  };

  return (
    <Screen back backTo="/home" contentStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header" style={styles.title}>
          {t('lb.title')}
        </Text>
        <Text variant="label" color={colors.inkSoft}>
          {period === 'week' ? t('lb.resetsMonday') : t('lb.resetsMidnight')}
        </Text>
      </View>

      <Segments
        items={tabs.map((tab) => ({ key: tab.scope, label: tab.label }))}
        selected={scope}
        onSelect={(key) => setScope(key as LeaderboardScope)}
        testPrefix="lb-scope"
      />
      <Segments
        small
        items={[
          { key: 'week', label: t('lb.week') },
          { key: 'daily', label: t('lb.today') },
        ]}
        selected={period}
        onSelect={(key) => setPeriod(key as Period)}
        testPrefix="lb-period"
      />

      {board.isLoading || (period === 'daily' && today.isLoading) ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} size="large" />
      ) : board.isError || today.isError ? (
        <View style={styles.empty}>
          <Text variant="body" align="center">
            {errorMessage(board.error ?? today.error, t('error.network'))}
          </Text>
          <Button label={t('error.retry')} variant="outline" onPress={() => void board.refetch()} />
        </View>
      ) : data && data.entries.length > 0 && !guestFriends ? (
        <View testID="lb-list">
          {data.entries.map((entry) => (
            <Row key={`${entry.rank}-${entry.username ?? ''}`} entry={entry} />
          ))}
          {meBelow ? (
            <>
              <Text variant="overline" style={styles.yourPlace}>
                {t('lb.yourPlace')}
              </Text>
              <Row entry={meBelow} />
            </>
          ) : null}
          {onlyYou ? (
            <Text variant="bodySoft" align="center" style={styles.empty}>
              {t('lb.friendsEmpty')}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text variant="bodySoft" align="center" style={styles.empty} testID="lb-empty">
          {emptyText()}
        </Text>
      )}
    </Screen>
  );
}

function Row({ entry }: { entry: LeaderboardEntry }) {
  const t = useT();
  const state = entry.home_state ? STATE_NAMES[entry.home_state] : null;
  const anonymous =
    entry.kind === 'guest' ? t('lb.guest') : state ? t('lb.playerFrom', { state }) : t('lb.aPlayer');
  const name = entry.username ?? (entry.you ? t('lb.youPlain') : anonymous);
  const label = entry.you && entry.username ? t('lb.you', { name }) : name;
  return (
    <View
      style={[styles.row, entry.you && styles.rowYou]}
      testID={entry.you ? 'lb-you' : undefined}
      accessibilityLabel={`${entry.rank}. ${label}, ${entry.score}`}
    >
      <Text style={[styles.rank, entry.rank <= 3 && styles.rankTop]}>{entry.rank}</Text>
      {entry.avatar_id ? <Avatar id={entry.avatar_id} size={48} /> : <InitialAvatar name={name} size={48} />}
      <View style={styles.who}>
        <Text variant="label" numberOfLines={1} style={styles.name}>
          {label}
        </Text>
        <Text variant="caption">{entry.tier.name}</Text>
      </View>
      <Text style={styles.score}>{entry.score.toLocaleString('en-NG')}</Text>
    </View>
  );
}

function Segments({
  items,
  selected,
  onSelect,
  small = false,
  testPrefix,
}: {
  items: Array<{ key: string; label: string }>;
  selected: string;
  onSelect: (key: string) => void;
  small?: boolean;
  testPrefix: string;
}) {
  return (
    <View style={[styles.segments, small && styles.segmentsSmall]} accessibilityRole="tablist">
      {items.map((item) => {
        const active = item.key === selected;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            aria-selected={active}
            onPress={() => onSelect(item.key)}
            style={[styles.segment, small && styles.segmentSmall, active && styles.segmentActive]}
            testID={`${testPrefix}-${item.key}`}
          >
            <Text variant="label" numberOfLines={1} color={active ? colors.ink : colors.inkSoft}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  title: { flexShrink: 1 },
  segments: {
    flexDirection: 'row',
    padding: 5,
    gap: 4,
    borderRadius: radius.card,
    backgroundColor: colors.sand,
  },
  segmentsSmall: { alignSelf: 'flex-start', borderRadius: radius.pill },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderRadius: 12 },
  segmentSmall: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  loading: { marginTop: 48 },
  empty: { marginTop: 32, gap: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.card,
  },
  rowYou: { backgroundColor: colors.primaryTint },
  rank: { width: 28, fontFamily: fonts.heavy, fontSize: 18, color: colors.inkSoft, textAlign: 'center' },
  rankTop: { color: colors.accentInk },
  who: { flex: 1, gap: 2 },
  name: { fontSize: 17 },
  score: { fontFamily: fonts.heavy, fontSize: 18, color: colors.ink },
  yourPlace: { marginTop: 12, marginBottom: 4, marginLeft: 12 },
});
