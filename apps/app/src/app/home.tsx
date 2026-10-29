/**
 * Home (mockup 08): your coins, the Daily, your turns, then a new challenge, the duels waiting on
 * the other player and recent results. The tab bar arrives with its features (M2).
 */
import { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { routes, type DuelSummary, type Me } from '@whosabi/shared-types';
import { api } from '../api';
import { signOut, updateUser, useSession } from '../auth/session';
import { SignInOptions } from '../features/auth/SignInOptions';
import { useDailyToday } from '../features/daily/api';
import { DailyBanner } from '../features/daily/DailyBanner';
import { InstallCard } from '../features/install/InstallCard';
import { HomeBanners } from '../features/liveops/HomeBanners';
import { useDuelList } from '../features/duels/api';
import { useWallet } from '../features/economy/api';
import { currentRound, isUrgent, timeLeft } from '../features/duels/format';
import { useOpponentName } from '../features/duels/parts';
import { useRandomDuel } from '../features/duels/useRandomDuel';
import { useFlag } from '../features/liveops/config';
import { sendQueued } from '../features/practice/store';
import { StatusBanner } from '../features/liveops/StatusBanner';
import { WarningCard } from '../features/moderation/notices';
import { useT } from '../i18n';
import { staffToolsHere } from '../platform/staffLock';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/icons';
import { PlayerRow, SectionTitle } from '../ui/rows';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, radius } from '../ui/theme';

export default function Home() {
  const t = useT();
  const { status, user } = useSession();
  const signedIn = status === 'guest' || status === 'account';
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>(routes.me()), enabled: signedIn });
  const active = useDuelList('active', signedIn);
  const done = useDuelList('done', signedIn);
  const daily = useDailyToday(signedIn);
  const wallet = useWallet(signedIn);
  const random = useRandomDuel();
  const partyOn = useFlag('party.enabled');

  // Coming back from a duel or the Daily: show the new state at once.
  const { refetch: refetchActive } = active;
  const { refetch: refetchDone } = done;
  const { refetch: refetchDaily } = daily;
  const { refetch: refetchWallet } = wallet;
  const { refetch: refetchMe } = me;
  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return;
      void refetchActive();
      void refetchDone();
      void refetchDaily();
      void refetchWallet();
      // Practice games played offline go now; the XP they pay can move the level.
      void sendQueued().then((paid) => (paid.size > 0 ? refetchMe() : undefined));
    }, [signedIn, refetchActive, refetchDone, refetchDaily, refetchWallet, refetchMe]),
  );

  // A moderator took the username away (step 2.7d): the player picks a new one.
  const serverName = me.data?.username;
  useEffect(() => {
    if (status === 'account' && me.data && serverName === null && user?.username)
      updateUser({ username: null });
  }, [status, me.data, serverName, user?.username]);

  if (status === 'signed_out') return <Redirect href="/welcome" />;
  if (status === 'account' && user && !user.username) return <Redirect href="/profile-setup" />;

  const name = user?.username ?? t('home.guestName');
  const level = me.data?.level ?? user?.level ?? 1;
  const duels = active.data?.duels ?? [];
  const yourTurn = duels.filter((d) => d.your_turn);
  const theirTurn = duels.filter((d) => !d.your_turn);
  const results = done.data?.duels ?? [];
  const nothingYet = active.isSuccess && done.isSuccess && duels.length === 0 && results.length === 0;

  return (
    <Screen>
      <View style={styles.header}>
        <Avatar id={me.data?.avatar_id} size={52} />
        <View style={styles.headerText}>
          <Text variant="heading" testID="greeting">
            {t('home.greeting', { name })}
          </Text>
          <Text variant="caption">
            {t('home.level', { level })}
            {me.data ? ` · ${me.data.tier.name} · ${Math.round(me.data.rating).toLocaleString('en-NG')}` : ''}
          </Text>
        </View>
        {wallet.data ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('home.coins', { coins: wallet.data.coins })}
            onPress={() => router.push('/coins')}
            style={({ pressed }) => [styles.coins, pressed && styles.pressed]}
            testID="open-coins"
          >
            <Icon name="coin" size={18} color={colors.accentInk} />
            <Text variant="label" testID="coin-balance">
              {wallet.data.coins.toLocaleString('en-NG')}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('nav.leaderboards')}
          hitSlop={8}
          onPress={() => router.push('/leaderboards')}
          testID="open-leaderboards"
        >
          <Icon name="trophy" size={26} />
        </Pressable>
        {me.data?.staff && staffToolsHere ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Staff tools"
            hitSlop={8}
            onPress={() => router.push('/staff')}
            testID="open-staff"
          >
            <Icon name="shield" size={26} color={colors.primaryInk} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('nav.notifications')}
          hitSlop={8}
          onPress={() => router.push('/notifications')}
          testID="open-notifications"
        >
          <Icon name="bell" size={26} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.title')}
          hitSlop={8}
          onPress={() => router.push('/settings')}
          testID="open-settings"
        >
          <Icon name="settings" size={26} />
        </Pressable>
        {status === 'account' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('home.friends')}
            hitSlop={8}
            onPress={() => router.push('/friends')}
            testID="open-friends"
          >
            <Icon name="users" size={26} />
          </Pressable>
        ) : null}
      </View>

      <StatusBanner />
      {me.data?.notices
        .filter((n) => n.kind === 'warning')
        .map((n) => (
          <WarningCard key={n.id} notice={n} />
        ))}
      {daily.data ? <DailyBanner today={daily.data} /> : null}
      <HomeBanners />
      <InstallCard />

      {yourTurn.length > 0 ? (
        <>
          <SectionTitle title={t('home.yourTurn')} count={yourTurn.length} />
          {yourTurn.map((duel) => (
            <TurnCard key={duel.id} duel={duel} />
          ))}
        </>
      ) : null}

      <View style={styles.actions}>
        <Action
          icon="swords"
          label={t('home.challenge')}
          onPress={() => router.push('/challenge')}
          testID="challenge"
        />
        <Action
          icon="users"
          label={t('home.party')}
          paused={!partyOn}
          onPress={() => router.push('/party')}
          testID="party"
        />
        <Action
          icon="shuffle"
          label={t('home.random')}
          busy={random.busy}
          onPress={() => void random.start()}
          testID="random"
        />
        <Action
          icon="book"
          label={t('home.practice')}
          onPress={() => router.push('/practice')}
          testID="practice"
        />
      </View>
      {random.error ? (
        <Text variant="body" color={colors.wrongInk} style={styles.error}>
          {random.error}
        </Text>
      ) : null}

      {nothingYet ? (
        <Text variant="bodySoft" align="center" style={styles.empty}>
          {t('home.empty')}
        </Text>
      ) : null}

      {theirTurn.length > 0 ? (
        <>
          <SectionTitle title={t('home.waiting')} />
          {theirTurn.map((duel) => (
            <WaitingRow key={duel.id} duel={duel} />
          ))}
        </>
      ) : null}

      {results.length > 0 ? (
        <>
          <SectionTitle title={t('home.recent')} />
          {results.map((duel) => (
            <ResultRow key={duel.id} duel={duel} />
          ))}
        </>
      ) : null}

      {status === 'guest' ? (
        <View style={styles.save}>
          <Text variant="heading">{t('home.saveTitle')}</Text>
          <Text variant="bodySoft">{t('home.saveBody')}</Text>
          <SignInOptions />
        </View>
      ) : null}

      <View style={styles.footer}>
        <Button
          label={t('home.playAgain')}
          variant="link"
          size="medium"
          onPress={() => router.push('/taste')}
          testID="play-again"
        />
        {status === 'account' ? (
          <Button
            label={t('home.signOut')}
            variant="link"
            size="medium"
            icon="logout"
            onPress={() => void signOut().then(() => router.replace('/welcome'))}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function useTimeText() {
  const t = useT();
  return (deadline: string | null) => {
    const left = timeLeft(deadline, Date.now());
    if (!left) return '';
    return 'hours' in left
      ? t('time.hoursLeft', { hours: left.hours })
      : t('time.minutesLeft', { minutes: left.minutes });
  };
}

function TurnCard({ duel }: { duel: DuelSummary }) {
  const t = useT();
  const timeText = useTimeText();
  const name = useOpponentName(duel);
  const fresh = duel.score.you === 0 && duel.score.opponent === 0;
  const round = currentRound(duel.state);
  const urgent = isUrgent(duel.turn_deadline, Date.now());
  return (
    <PlayerRow
      card
      name={name}
      onPress={() => router.push(`/duel/${duel.id}`)}
      testID={`turn-${duel.id}`}
      subtitle={
        <>
          <Text variant="caption">
            {fresh
              ? t('home.newChallenge', { round })
              : t('home.roundScore', { round, you: duel.score.you, name, opponent: duel.score.opponent })}
          </Text>
          {duel.turn_deadline ? (
            <View style={styles.time}>
              <Icon name="clock" size={16} color={urgent ? colors.accentInk : colors.inkSoft} />
              <Text variant="caption" color={urgent ? colors.accentInk : colors.inkSoft}>
                {timeText(duel.turn_deadline)}
              </Text>
            </View>
          ) : null}
        </>
      }
      right={<Button label={t('home.play')} size="medium" onPress={() => router.push(`/duel/${duel.id}`)} />}
    />
  );
}

function WaitingRow({ duel }: { duel: DuelSummary }) {
  const t = useT();
  const timeText = useTimeText();
  const name = useOpponentName(duel);
  const finding = !duel.opponent && duel.source === 'random';
  return (
    <PlayerRow
      name={duel.opponent || finding ? name : t('challenge.link')}
      subtitle={
        duel.opponent
          ? t('home.theirTurn', { round: currentRound(duel.state) })
          : finding
            ? t('home.findingWaiting')
            : t('home.linkWaiting')
      }
      right={<Text variant="caption">{timeText(duel.turn_deadline)}</Text>}
      onPress={() => router.push(`/duel/${duel.id}`)}
      testID={`waiting-${duel.id}`}
    />
  );
}

function ResultRow({ duel }: { duel: DuelSummary }) {
  const t = useT();
  const name = useOpponentName(duel);
  const title =
    duel.result === 'win'
      ? t('home.youWon', { name })
      : duel.result === 'loss'
        ? t('home.youLost', { name })
        : duel.result === 'draw'
          ? t('home.drew', { name })
          : t('home.ended', { name });
  const score = `${duel.score.you.toLocaleString('en-NG')} ${t('duel.to')} ${duel.score.opponent.toLocaleString('en-NG')}`;
  const rating =
    duel.rating_delta !== null
      ? ` · ${t('duel.rating')} ${duel.rating_delta >= 0 ? '+' : ''}${Math.round(duel.rating_delta)}`
      : '';
  return (
    <PlayerRow
      name={title}
      subtitle={
        <Text variant="caption" color={duel.result === 'win' ? colors.correctInk : colors.inkSoft}>
          {score}
          {rating}
        </Text>
      }
      right={
        <Text variant="label" color={colors.primaryInk}>
          {t('home.seeResult')}
        </Text>
      }
      onPress={() => router.push(`/duel/${duel.id}`)}
      testID={`result-${duel.id}`}
    />
  );
}

function Action({
  icon,
  label,
  onPress,
  soon = false,
  paused = false,
  busy = false,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  soon?: boolean;
  /** Switched off by staff for now (a kill switch, step 2.7c). */
  paused?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  const t = useT();
  const note = soon ? t('home.soon') : paused ? t('home.paused') : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={note ? `${label} (${note})` : label}
      accessibilityState={{ disabled: Boolean(note) || busy, busy }}
      disabled={Boolean(note) || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.action, note && styles.actionSoon, (pressed || busy) && styles.pressed]}
      testID={testID}
    >
      <Icon name={icon} size={28} color={colors.primaryInk} />
      <Text variant="label" align="center">
        {label}
      </Text>
      {note ? <Text variant="caption">{note}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  headerText: { flex: 1, gap: 2 },
  coins: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.accentTint,
  },
  time: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 16,
    paddingHorizontal: 6,
    borderRadius: radius.card,
    backgroundColor: colors.primaryTint,
  },
  actionSoon: { opacity: 0.6 },
  error: { marginTop: 8 },
  pressed: { opacity: 0.85 },
  empty: { marginTop: 20 },
  save: {
    borderRadius: radius.card,
    padding: 16,
    gap: 12,
    marginTop: 24,
    backgroundColor: colors.accentTint,
  },
  footer: { marginTop: 16, alignItems: 'center' },
});
