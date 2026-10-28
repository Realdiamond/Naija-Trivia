/**
 * A party link (whosabi.ng/r/{CODE}, mockup 29): whose party it is and who is in, then a seat.
 * Signed in, you join as yourself; otherwise a nickname is all it takes: no app, no sign-up
 * (TRD FR-PARTY-7).
 */
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { normaliseRoomCode } from '@whosabi/game-rules';
import { ApiError, errorMessage } from '../../api';
import { useSession } from '../../auth/session';
import { party, saveSeat, seatFor } from '../../features/party/api';
import { useT } from '../../i18n';
import { InitialAvatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors } from '../../ui/theme';

export default function PartyLink() {
  const t = useT();
  const params = useLocalSearchParams<{ code: string }>();
  const code = normaliseRoomCode(params.code ?? '') ?? (params.code ?? '').toUpperCase();
  const { status, user } = useSession();
  const signedIn = status === 'guest' || status === 'account';
  const preview = useQuery({
    queryKey: ['party-room', code],
    queryFn: () => party.preview(code),
    retry: false,
    refetchInterval: 5000,
  });
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsNickname = !signedIn || !user?.username;
  const join = async () => {
    // Already in this room (a reload, or back from another screen): straight back to the seat.
    if (seatFor(code)) return router.replace(`/party/${code}`);
    setBusy(true);
    setError(null);
    try {
      const seat = await party.join(code, needsNickname ? { nickname: nickname.trim() } : {}, signedIn);
      saveSeat(seat);
      router.replace(`/party/${seat.code}`);
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
      setBusy(false);
    }
  };

  const room = preview.data;
  const missing = preview.error instanceof ApiError && preview.error.status === 404;

  return (
    <Screen
      background={colors.night}
      footer={
        room ? (
          <Button
            label={needsNickname ? t('party.joinGame') : t('party.joinAs', { name: user!.username! })}
            trailingIcon="arrow-right"
            variant="accent"
            loading={busy || status === 'loading'}
            disabled={needsNickname && nickname.trim().length < 2}
            onPress={() => void join()}
            testID="party-join"
          />
        ) : missing ? (
          <Button
            label={t('party.startOwn')}
            variant="accent"
            onPress={() => router.replace(signedIn ? '/party' : '/welcome')}
          />
        ) : null
      }
    >
      <Text variant="heading" color={colors.white}>
        Who Sabi?{' '}
        <Text variant="heading" color={colors.gold}>
          Party
        </Text>
      </Text>
      {preview.isPending ? (
        <ActivityIndicator style={styles.loading} color={colors.gold} size="large" />
      ) : null}
      {room ? (
        <View style={styles.card}>
          <Text variant="overline" color={colors.gold}>
            {t('party.roomLabel', { code: room.code })}
          </Text>
          <Text variant="display" color={colors.white} accessibilityRole="header" testID="party-joining">
            {t('party.joining', { host: room.host })}
          </Text>
          <View style={styles.people}>
            <View style={styles.faces}>
              {room.names.map((name, i) => (
                <View key={`${name}-${i}`} style={[styles.face, i > 0 && styles.overlap]}>
                  <InitialAvatar name={name} size={40} />
                </View>
              ))}
            </View>
            <Text variant="body" color={colors.white}>
              {t('party.inLobby', { count: room.players })}
            </Text>
          </View>
          {room.status !== 'lobby' ? (
            <Text variant="bodySoft" color={colors.borderStrong}>
              {t('party.playingNow')}
            </Text>
          ) : null}
          {needsNickname ? (
            <View style={styles.nickname}>
              <Field
                label={t('party.nickname')}
                placeholder={t('party.nicknamePlaceholder')}
                value={nickname}
                onChangeText={setNickname}
                onSubmitEditing={() => void join()}
                maxLength={20}
                autoCapitalize="words"
                testID="party-nickname"
              />
              <Text variant="caption">{t('party.noSignup')}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {missing ? (
        <Text variant="heading" color={colors.white} style={styles.card}>
          {t('party.notFound')}
        </Text>
      ) : preview.isError ? (
        <Text variant="heading" color={colors.white} style={styles.card}>
          {errorMessage(preview.error, t('error.network'))}
        </Text>
      ) : null}
      {error ? (
        <Text variant="body" color={colors.gold} accessibilityLiveRegion="polite" testID="party-join-error">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 80 },
  card: { gap: 16, marginTop: 36 },
  people: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  faces: { flexDirection: 'row' },
  face: { borderRadius: 22, borderWidth: 2, borderColor: colors.night },
  overlap: { marginLeft: -12 },
  nickname: { gap: 8, marginTop: 8, padding: 16, borderRadius: 16, backgroundColor: colors.bg },
});
