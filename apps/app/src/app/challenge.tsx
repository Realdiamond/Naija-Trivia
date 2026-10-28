/** Start a duel (mockup 09): a link for anyone, or straight at a friend or recent opponent. */
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  routes,
  type CreateDuelRequest,
  type FriendsResponse,
  type ProfileCard,
} from '@whosabi/shared-types';
import { api, errorMessage } from '../api';
import { useSession } from '../auth/session';
import { duelKeys, duels } from '../features/duels/api';
import { useT } from '../i18n';
import { randomId } from '../platform/random';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { PlayerRow, SectionTitle } from '../ui/rows';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, radius } from '../ui/theme';

export default function Challenge() {
  const t = useT();
  const status = useSession((s) => s.status);
  const queryClient = useQueryClient();
  const friends = useQuery({
    queryKey: ['friends'],
    queryFn: () => api.get<FriendsResponse>(routes.friends()),
    enabled: status === 'account',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One key per tap target, so a retried request never starts a second duel.
  const keys = useRef(new Map<string, string>());

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  const start = async (target: string, opponent: CreateDuelRequest['opponent']) => {
    setBusy(target);
    setError(null);
    let key = keys.current.get(target);
    if (!key) keys.current.set(target, (key = randomId(16)));
    try {
      const { duel } = await duels.create(opponent, key);
      queryClient.setQueryData(duelKeys.one(duel.id), duel);
      void queryClient.invalidateQueries({ queryKey: duelKeys.all });
      router.replace(`/duel/${duel.id}`);
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
      setBusy(null);
    }
  };

  const challengeRow = (card: ProfileCard) => (
    <PlayerRow
      key={card.id}
      name={card.username ?? t('duel.guestOpponent')}
      avatarId={card.avatar_id}
      subtitle={`${card.tier.name} · ${t('home.level', { level: card.level })}`}
      right={
        <Button
          label={t('challenge.challengeButton')}
          size="medium"
          loading={busy === card.id}
          disabled={busy !== null}
          onPress={() => void start(card.id, { user_id: card.id })}
          testID={`challenge-${card.username ?? card.id}`}
        />
      }
    />
  );

  const friendList = friends.data?.friends.map((f) => f.user) ?? [];
  const recent = friends.data?.suggested ?? [];

  return (
    <Screen back backTo="/home">
      <Text variant="display" accessibilityRole="header">
        {t('challenge.title')}
      </Text>
      <Text variant="bodySoft">{t('challenge.rules')}</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('challenge.link')}
        disabled={busy !== null}
        onPress={() => void start('link', { link: true })}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        testID="send-link"
      >
        <View style={styles.linkIcon}>
          <Icon name="link" color={colors.gold} />
        </View>
        <View style={styles.linkText}>
          <Text variant="heading">{t('challenge.link')}</Text>
          <Text variant="body">{t('challenge.linkBody')}</Text>
        </View>
      </Pressable>

      {error ? (
        <Text variant="body" color={colors.wrongInk} accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {status === 'account' ? (
        <>
          <SectionTitle title={t('challenge.friends', { count: friendList.length })} />
          {friendList.length > 0 ? (
            friendList.map(challengeRow)
          ) : friends.isSuccess ? (
            <Text variant="bodySoft">{t('challenge.noFriends')}</Text>
          ) : null}
          {recent.length > 0 ? (
            <>
              <SectionTitle title={t('challenge.recent')} />
              {recent.map(challengeRow)}
            </>
          ) : null}
          <Button
            label={t('challenge.addFriends')}
            variant="link"
            onPress={() => router.push('/friends')}
            style={styles.addFriends}
          />
        </>
      ) : (
        <Text variant="bodySoft" style={styles.guest}>
          {t('challenge.guestFriends')}
        </Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    marginTop: 16,
    borderRadius: radius.card + 4,
    backgroundColor: colors.accent,
  },
  pressed: { opacity: 0.9 },
  linkIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { flex: 1, gap: 2 },
  error: { marginTop: 12 },
  addFriends: { marginTop: 8 },
  guest: { marginTop: 20 },
});
