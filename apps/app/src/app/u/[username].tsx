/**
 * A friend code opened (step 2.12): whosabi.ng/u/{username}, from a QR code or a shared link. It
 * shows who it is, and an account adds them or challenges them; a guest is asked to sign up first.
 */
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { routes, type FriendRequestResult, type ProfileCard } from '@whosabi/shared-types';
import { api, errorMessage } from '../../api';
import { ensureSignedIn, useSession } from '../../auth/session';
import { SignInOptions } from '../../features/auth/SignInOptions';
import { duelKeys, duels } from '../../features/duels/api';
import { useT } from '../../i18n';
import { randomId } from '../../platform/random';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

export default function FriendLink() {
  const t = useT();
  const { username } = useLocalSearchParams<{ username: string }>();
  const { status, user } = useSession();
  const queryClient = useQueryClient();
  const card = useQuery({
    queryKey: ['user', username],
    queryFn: async () => {
      // Opened fresh from a link: play as a guest on this device if not signed in yet.
      if (useSession.getState().status === 'signed_out') await ensureSignedIn();
      return api.get<ProfileCard>(routes.user(username!));
    },
    enabled: Boolean(username) && status !== 'loading',
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [key] = useState(() => randomId(16));

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const done = await work();
      if (done) setMessage({ text: done, ok: true });
    } catch (e) {
      setMessage({ text: errorMessage(e, t('error.network')), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const them = card.data;
  const name = them?.username ?? username ?? '';
  const mine = Boolean(them && user && them.id === user.id);

  return (
    <Screen back backTo="/home">
      {card.isPending ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} size="large" />
      ) : null}
      {card.isError ? (
        <Text variant="heading" align="center" style={styles.loading} testID="friend-missing">
          {t('code.missing')}
        </Text>
      ) : null}
      {them ? (
        <View style={styles.card} testID="friend-card">
          <Avatar id={them.avatar_id} size={88} />
          <Text variant="title">{name}</Text>
          <Text variant="label" color={colors.primaryInk}>
            {them.tier.badge} {them.tier.name} · {t('home.level', { level: them.level })}
          </Text>
          <Text variant="bodySoft">{t('code.wants')}</Text>
        </View>
      ) : null}
      {them && mine ? (
        <Text variant="bodySoft" align="center">
          {t('code.yours')}
        </Text>
      ) : null}
      {them && !mine && status === 'account' ? (
        <View style={styles.actions}>
          <Button
            label={t('code.add', { name })}
            loading={busy}
            onPress={() =>
              void run(async () => {
                const result = await api.post<FriendRequestResult>(routes.friendRequests(), {
                  user_id: them.id,
                  source: 'qr',
                });
                await queryClient.invalidateQueries({ queryKey: ['friends'] });
                return result.status === 'accepted'
                  ? t('friends.nowFriends', { name })
                  : t('friends.sent', { name });
              })
            }
            testID="friend-add"
          />
          <Button
            label={t('code.challenge', { name })}
            variant="outline"
            loading={busy}
            onPress={() =>
              void run(async () => {
                const { duel } = await duels.create({ user_id: them.id }, key);
                queryClient.setQueryData(duelKeys.one(duel.id), duel);
                router.replace(`/duel/${duel.id}`);
              })
            }
            testID="friend-challenge"
          />
        </View>
      ) : null}
      {them && !mine && status === 'guest' ? (
        <View style={styles.actions}>
          <Text variant="bodySoft" align="center">
            {t('code.guest', { name })}
          </Text>
          <SignInOptions />
        </View>
      ) : null}
      {message ? (
        <Text
          variant="body"
          align="center"
          color={message.ok ? colors.correctInk : colors.wrongInk}
          testID="friend-message"
        >
          {message.text}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 80 },
  card: {
    alignItems: 'center',
    gap: 8,
    padding: 24,
    marginTop: 24,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actions: { gap: 12, marginTop: 20 },
});
