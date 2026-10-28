/**
 * The party lobby (mockup 18): the room code big, the link to share on WhatsApp, a QR code for
 * people in the same room, and who is in. The host can lock the room, remove people and start
 * once there are two players (UX §2.3).
 */
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PARTY_MIN_PLAYERS } from '@whosabi/game-rules';
import type { PartyRoomState } from '@whosabi/shared-types';
import { trackEvent } from '../../analytics';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, CONTENT_MAX_WIDTH, fonts, radius } from '../../ui/theme';
import { PlayerAvatar, RoomQr, useKindLabel } from './parts';
import type { PartyView } from './useParty';

interface Props {
  room: PartyRoomState;
  view: PartyView;
  isHost: boolean;
  onStart: () => void;
  onKick: (playerId: string) => void;
  onLock: (locked: boolean) => void;
  onLeave: () => void;
}

export function Lobby({ room, view, isHost, onStart, onKick, onLock, onLeave }: Props) {
  const t = useT();
  const kindLabel = useKindLabel();
  const [copied, setCopied] = useState(false);
  const connected = room.players.filter((p) => p.connected).length;
  const host = room.players.find((p) => p.id === room.host_id);
  const summary = t(room.settings.wahala ? 'party.summaryWahala' : 'party.summary', {
    questions: room.settings.questions,
    timer: room.settings.timer_s,
  });
  const message = t('party.shareMessage', { code: room.code, url: room.link });

  const whatsapp = () => {
    trackEvent('invite_shared', { channel: 'whatsapp', context: 'party' });
    void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
  };
  const copy = async () => {
    await Clipboard.setStringAsync(room.link);
    trackEvent('invite_shared', { channel: 'copy', context: 'party' });
    setCopied(true);
  };

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <SafeAreaView edges={['top']} style={styles.header}>
        <View style={styles.column}>
          <View style={styles.topRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('party.leave')}
              hitSlop={12}
              onPress={onLeave}
              testID="party-leave"
            >
              <Icon name="cross" color={colors.white} size={28} />
            </Pressable>
            <Text variant="label" color={colors.white} numberOfLines={1} style={styles.summary}>
              {summary}
            </Text>
          </View>
          <View style={styles.codeRow}>
            <View style={styles.codeText}>
              <Text variant="overline" color={colors.gold}>
                {t('party.roomCode')}
              </Text>
              <Text style={styles.code} testID="party-code" selectable>
                {room.code}
              </Text>
              <Text variant="label" color={colors.white} numberOfLines={1} testID="party-link">
                {room.link.replace(/^https?:\/\//, '')}
              </Text>
            </View>
            <RoomQr code={room.code} size={104} />
          </View>
          <View style={styles.shareRow}>
            <Button
              label={t('party.shareWhatsapp')}
              variant="accent"
              size="medium"
              onPress={whatsapp}
              style={styles.grow}
            />
            <Button
              label={copied ? t('party.copied') : t('party.copyLink')}
              variant="ghost-light"
              size="medium"
              onPress={() => void copy()}
              testID="party-copy"
            />
          </View>
        </View>
      </SafeAreaView>

      <View style={[styles.column, styles.body]}>
        <View style={styles.playersHead}>
          <Text variant="heading">
            {t('party.players', { count: room.players.length, max: room.max_players })}
          </Text>
          {isHost ? (
            <View style={styles.lock}>
              <Text variant="label">{t('party.lock')}</Text>
              <Switch
                value={room.locked}
                onValueChange={onLock}
                trackColor={{ true: colors.primary, false: colors.borderStrong }}
                accessibilityLabel={t('party.lock')}
                testID="party-lock"
              />
            </View>
          ) : null}
        </View>
        <View style={styles.grid}>
          {room.players.map((p) => (
            <View
              key={p.id}
              style={[styles.player, !p.connected && styles.away]}
              testID={`party-player-${p.name}`}
            >
              <PlayerAvatar player={p} size={44} />
              <View style={styles.grow}>
                <Text variant="label" numberOfLines={1}>
                  {p.name}
                  {p.id === view.you?.id ? ` (${t('party.you')})` : ''}
                </Text>
                <Text variant="caption" numberOfLines={1}>
                  {p.id === room.host_id ? `${t('party.host')} · ${kindLabel(p.kind)}` : kindLabel(p.kind)}
                </Text>
              </View>
              {isHost && p.id !== view.you?.id ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('party.kick', { name: p.name })}
                  hitSlop={10}
                  onPress={() => onKick(p.id)}
                >
                  <Icon name="cross" size={20} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
        <View style={styles.waiting}>
          <View style={styles.dot} />
          <Text variant="bodySoft" style={styles.grow}>
            {isHost || !host ? t('party.waitingPeople') : t('party.waitingHost', { name: host.name })}
          </Text>
        </View>
        {view.error && isHost ? (
          <Text variant="body" color={colors.wrongInk} accessibilityLiveRegion="polite" testID="party-error">
            {view.error.message}
          </Text>
        ) : null}
      </View>

      {isHost ? (
        <View style={[styles.column, styles.footer]}>
          {connected < PARTY_MIN_PLAYERS ? (
            <Text variant="caption" align="center">
              {t('party.needTwo')}
            </Text>
          ) : null}
          <Button
            label={t('party.start')}
            trailingIcon="arrow-right"
            disabled={connected < PARTY_MIN_PLAYERS}
            onPress={onStart}
            testID="party-start"
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.night, paddingBottom: 20 },
  column: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingTop: 12 },
  summary: { flex: 1, textAlign: 'right' },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 16 },
  codeText: { flex: 1, gap: 4 },
  code: { fontFamily: fonts.display, fontSize: 56, lineHeight: 62, letterSpacing: 4, color: colors.white },
  shareRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  grow: { flex: 1 },
  body: { flex: 1, paddingTop: 20, gap: 12 },
  playersHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  player: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  away: { opacity: 0.5 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.correct },
  footer: { paddingTop: 12, paddingBottom: 16, gap: 8 },
});
