/**
 * Friends (mockup 23): the player's friend code (step 2.12), add by username, answer requests,
 * add recent opponents, challenge friends.
 */
import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  routes,
  Username,
  type FriendRequestResult,
  type FriendsResponse,
  type ProfileCard,
} from '@whosabi/shared-types';
import { api, errorMessage } from '../api';
import { useSession } from '../auth/session';
import { duelKeys, duels } from '../features/duels/api';
import { FriendCode } from '../features/friends/FriendCode';
import { useT } from '../i18n';
import { randomId } from '../platform/random';
import { Button } from '../ui/Button';
import { PlayerRow, SectionTitle } from '../ui/rows';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, fonts, radius } from '../ui/theme';

export default function Friends() {
  const t = useT();
  const status = useSession((s) => s.status);
  const queryClient = useQueryClient();
  const friends = useQuery({
    queryKey: ['friends'],
    queryFn: () => api.get<FriendsResponse>(routes.friends()),
    enabled: status === 'account',
  });
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const keys = useRef(new Map<string, string>());

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  const act = async (target: string, run: () => Promise<string | void>) => {
    setBusy(target);
    setMessage(null);
    try {
      const done = await run();
      if (done) setMessage({ text: done, ok: true });
      await queryClient.invalidateQueries({ queryKey: ['friends'] });
    } catch (e) {
      setMessage({ text: errorMessage(e, t('error.network')), ok: false });
    } finally {
      setBusy(null);
    }
  };

  const sendRequest = (body: object, fallbackName: string) =>
    act(fallbackName, async () => {
      const result = await api.post<FriendRequestResult>(routes.friendRequests(), body);
      const name = result.user.username ?? fallbackName;
      setUsername('');
      return result.status === 'accepted' ? t('friends.nowFriends', { name }) : t('friends.sent', { name });
    });

  const challenge = (card: ProfileCard) =>
    act(card.id, async () => {
      let key = keys.current.get(card.id);
      if (!key) keys.current.set(card.id, (key = randomId(16)));
      const { duel } = await duels.create({ user_id: card.id }, key);
      queryClient.setQueryData(duelKeys.one(duel.id), duel);
      router.push(`/duel/${duel.id}`);
    });

  if (status !== 'account') {
    return (
      <Screen back backTo="/home">
        <Text variant="display">{t('friends.title')}</Text>
        <Text variant="bodySoft" style={styles.note}>
          {t('friends.guest')}
        </Text>
        <Button label={t('home.saveButton')} onPress={() => router.push('/sign-in')} />
      </Screen>
    );
  }

  const data = friends.data;
  const valid = Username.safeParse(username).success;
  const nameOf = (card: ProfileCard) => card.username ?? t('duel.guestOpponent');

  return (
    <Screen back backTo="/home">
      <Text variant="display" accessibilityRole="header">
        {t('friends.title')}
        {data ? (
          <Text variant="heading" color={colors.muted}>
            {' '}
            ({data.friends.length})
          </Text>
        ) : null}
      </Text>

      <FriendCode />

      <View style={styles.add}>
        <TextInput
          accessibilityLabel={t('friends.addPlaceholder')}
          placeholder={t('friends.addPlaceholder')}
          placeholderTextColor={colors.muted}
          value={username}
          onChangeText={(text) => setUsername(text.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          onSubmitEditing={() => valid && void sendRequest({ username, source: 'username' }, username)}
          style={styles.input}
          testID="friend-username"
        />
        <Button
          label={t('friends.send')}
          size="medium"
          disabled={!valid}
          loading={busy === username && username !== ''}
          onPress={() => void sendRequest({ username, source: 'username' }, username)}
          style={styles.send}
          testID="friend-send"
        />
      </View>
      {message ? (
        <Text
          variant="body"
          color={message.ok ? colors.correctInk : colors.wrongInk}
          accessibilityLiveRegion="polite"
          style={styles.note}
          testID="friends-message"
        >
          {message.text}
        </Text>
      ) : null}

      {data && data.incoming.length > 0 ? (
        <>
          <SectionTitle title={t('friends.requests')} />
          {data.incoming.map(({ user }) => (
            <PlayerRow
              key={user.id}
              name={nameOf(user)}
              avatarId={user.avatar_id}
              subtitle={t('friends.wantsToBe')}
              right={
                <>
                  <Button
                    label={t('friends.accept')}
                    size="medium"
                    disabled={busy !== null}
                    onPress={() =>
                      void act(user.id, async () => {
                        await api.post(routes.friendAccept(user.id));
                        return t('friends.nowFriends', { name: nameOf(user) });
                      })
                    }
                    testID={`accept-${user.username}`}
                  />
                  <Button
                    label={t('friends.decline')}
                    size="medium"
                    variant="outline"
                    disabled={busy !== null}
                    onPress={() => void act(user.id, () => api.post(routes.friendDecline(user.id)))}
                  />
                </>
              }
            />
          ))}
        </>
      ) : null}

      {data && data.suggested.length > 0 ? (
        <>
          <SectionTitle title={t('friends.recent')} />
          {data.suggested.map((user) => (
            <PlayerRow
              key={user.id}
              name={nameOf(user)}
              avatarId={user.avatar_id}
              subtitle={`${user.tier.name} · ${t('home.level', { level: user.level })}`}
              right={
                <Button
                  label={t('friends.add')}
                  size="medium"
                  variant="outline"
                  disabled={busy !== null}
                  onPress={() => void sendRequest({ user_id: user.id, source: 'opponent' }, nameOf(user))}
                />
              }
            />
          ))}
        </>
      ) : null}

      {data ? (
        <>
          <SectionTitle title={t('friends.yours')} />
          {data.friends.length === 0 ? <Text variant="bodySoft">{t('friends.none')}</Text> : null}
          {data.friends.map(({ user }) => (
            <PlayerRow
              key={user.id}
              name={nameOf(user)}
              avatarId={user.avatar_id}
              subtitle={`${user.tier.name} · ${t('home.level', { level: user.level })}`}
              right={
                <Button
                  label={t('challenge.challengeButton')}
                  size="medium"
                  loading={busy === user.id}
                  disabled={busy !== null}
                  onPress={() => void challenge(user)}
                  testID={`friend-challenge-${user.username}`}
                />
              }
            />
          ))}
          {data.outgoing.length > 0 ? (
            <>
              <SectionTitle title={t('friends.outgoing')} />
              {data.outgoing.map(({ user }) => (
                <PlayerRow key={user.id} name={nameOf(user)} avatarId={user.avatar_id} />
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  add: { flexDirection: 'row', gap: 10, marginTop: 16 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: colors.inputBorder,
    borderRadius: radius.button + 4,
    backgroundColor: colors.surface,
    fontFamily: fonts.bold,
    fontSize: 17,
    color: colors.ink,
  },
  send: { minHeight: 50 },
  note: { marginVertical: 12 },
});
