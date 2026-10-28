/**
 * A party room, from the lobby to the podium (UX §2.3). The server says which phase the room is
 * in; each player's screen follows, from the room's WebSocket (API §3).
 */
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { normaliseRoomCode } from '@whosabi/game-rules';
import type { PartySeat } from '@whosabi/shared-types';
import { useSession } from '../../auth/session';
import { forgetSeat, seatFor } from '../../features/party/api';
import { Lobby } from '../../features/party/Lobby';
import { PartyToast } from '../../features/party/parts';
import { Countdown, PartyQuestion, PartyReveal } from '../../features/party/PartyGame';
import { Podium } from '../../features/party/Podium';
import { useParty } from '../../features/party/useParty';
import { useT, type MessageKey } from '../../i18n';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors } from '../../ui/theme';

export default function PartyRoomScreen() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = normaliseRoomCode(params.code ?? '') ?? '';
  const seat = useMemo(() => (code ? seatFor(code) : null), [code]);
  if (!seat) return <Redirect href={`/r/${code || params.code}`} />;
  return <Room seat={seat} />;
}

function Room({ seat }: { seat: PartySeat }) {
  const t = useT();
  const signedIn = useSession((s) => s.status === 'guest' || s.status === 'account');
  const { view, act } = useParty(seat);
  const room = view.room;

  const goHome = () => {
    act.leave();
    forgetSeat(seat.code);
    router.replace(signedIn ? '/home' : '/');
  };

  if (view.status === 'closed') {
    const code = view.end?.code;
    const key = (code && code >= 4000 && code <= 4004 ? `party.end.${code}` : 'party.end.lost') as MessageKey;
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="heading" align="center" testID="party-ended">
            {view.podium && code === 4000 ? t('party.end.4000') : t(key)}
          </Text>
          <Button label={t('party.home')} onPress={goHome} />
        </View>
      </Screen>
    );
  }
  if (!room || !view.you) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const isHost = view.you.id === room.host_id;
  const plays = room.players.some((p) => p.id === view.you!.id);
  let screen: React.ReactNode;
  switch (room.phase) {
    case 'LOBBY':
    case 'CLOSED':
      screen = (
        <Lobby
          room={room}
          view={view}
          isHost={isHost}
          onStart={() => act.send({ type: 'start' })}
          onKick={(id) => act.send({ type: 'kick', player_id: id })}
          onLock={(locked) => act.send({ type: 'lock', locked })}
          onLeave={goHome}
        />
      );
      break;
    case 'COUNTDOWN':
      screen = <Countdown room={room} serverNow={act.serverNow} />;
      break;
    case 'QUESTION':
      screen = (
        <PartyQuestion
          room={room}
          view={view}
          plays={plays}
          serverNow={act.serverNow}
          onAnswer={(q, i) => act.answer(q, i, view.shownAt)}
        />
      );
      break;
    case 'REVEAL':
    case 'LEADERBOARD':
      screen = <PartyReveal room={room} view={view} plays={plays} />;
      break;
    case 'PODIUM':
      screen = view.podium ? (
        <Podium
          podium={view.podium}
          code={room.code}
          youId={view.you.id}
          isHost={isHost}
          onPlayAgain={() => act.send({ type: 'play_again' })}
          onHome={goHome}
        />
      ) : null;
      break;
  }
  return (
    <View style={styles.root}>
      {screen}
      <PartyToast toast={view.toast} />
      {view.status === 'reconnecting' ? (
        <View style={styles.banner} accessibilityLiveRegion="polite">
          <Text variant="label" color={colors.white}>
            {t('party.reconnecting')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', gap: 20 },
  banner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    alignItems: 'center',
    backgroundColor: colors.accentInk,
  },
});
