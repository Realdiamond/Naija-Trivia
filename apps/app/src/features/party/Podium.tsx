/**
 * The end of a party game (mockup 20): the top three on a podium, the MVP of the night, everyone
 * else in order, and the host's "Play again" for another game in the same room.
 */
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PartyPodiumMessage } from '@whosabi/shared-types';
import { trackEvent } from '../../analytics';
import { useT } from '../../i18n';
import { canShare, shareText } from '../../platform/share';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, CONTENT_MAX_WIDTH, fonts, radius } from '../../ui/theme';
import { PlayerAvatar, useKindLabel } from './parts';

interface Props {
  podium: PartyPodiumMessage;
  code: string;
  youId: string | undefined;
  isHost: boolean;
  onPlayAgain: () => void;
  onHome: () => void;
}

/** Second, first, third: the winner in the middle, highest. */
const STEPS = [
  { place: 2, height: 120, color: '#26352D' },
  { place: 1, height: 160, color: colors.gold },
  { place: 3, height: 90, color: '#26352D' },
];

export function Podium({ podium, code, youId, isHost, onPlayAgain, onHome }: Props) {
  const t = useT();
  const kindLabel = useKindLabel();
  const winner = podium.ranking[0];
  const scored = winner && winner.score > 0;
  const top = podium.ranking.slice(0, 3);
  const rest = podium.ranking.slice(3);

  const share = async () => {
    const text = t('party.resultText', { name: winner?.name ?? '', code, url: podium.share_url });
    // No share sheet (a computer): WhatsApp, where the group is.
    if (!canShare) {
      trackEvent('invite_shared', { channel: 'whatsapp', context: 'party' });
      void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
      return;
    }
    if (await shareText(text, podium.share_url))
      trackEvent('invite_shared', { channel: 'web_share', context: 'party' });
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.column}>
          <Text variant="overline" color={colors.gold} align="center">
            {t('party.gameOver', { code })}
          </Text>
          <Text variant="display" color={colors.white} align="center" testID="party-winner">
            {scored ? t('party.winner', { name: winner.name }) : t('party.draw')}
          </Text>

          <View style={styles.podium}>
            {STEPS.map(({ place, height, color }) => {
              const p = top.find((_, i) => i === place - 1);
              if (!p) return <View key={place} style={styles.step} />;
              return (
                <View key={place} style={styles.step}>
                  <View style={[styles.ring, place === 1 && styles.ringGold]}>
                    <PlayerAvatar player={p} size={place === 1 ? 64 : 52} />
                  </View>
                  <Text variant="label" color={colors.white} numberOfLines={1} align="center">
                    {p.name}
                    {p.id === youId ? ` (${t('party.you')})` : ''}
                  </Text>
                  <Text variant="caption" color={colors.white}>
                    {p.score.toLocaleString('en-NG')}
                  </Text>
                  <View style={[styles.block, { height, backgroundColor: color }]}>
                    <Text style={[styles.place, place === 1 && styles.placeFirst]}>{p.rank}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {podium.mvp ? (
            <View style={styles.mvp} testID="party-mvp">
              <Icon name="trophy" color={colors.gold} size={28} />
              <View style={styles.grow}>
                <Text variant="label" color={colors.gold}>
                  {t('party.mvp')}
                </Text>
                <Text variant="body" color={colors.white}>
                  {t('party.mvpLine', {
                    name: podium.mvp.name,
                    correct: podium.mvp.correct,
                    total: podium.mvp.total,
                    seconds: (podium.mvp.fastest_ms / 1000).toFixed(1),
                  })}
                </Text>
              </View>
            </View>
          ) : null}

          {rest.map((p) => (
            <View key={p.id} style={styles.row}>
              <Text variant="label" color={colors.white} style={styles.rank}>
                {p.rank}
              </Text>
              <Text variant="body" color={colors.white} style={styles.grow} numberOfLines={1}>
                {p.name}
                {p.id === youId ? ` (${t('party.you')})` : ''}
              </Text>
              <Text variant="caption" color={colors.borderStrong}>
                {kindLabel(p.kind)}
              </Text>
              <Text variant="label" color={colors.white} style={styles.points}>
                {p.score.toLocaleString('en-NG')}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
      <View style={[styles.column, styles.footer]}>
        <Button label={t('party.shareResult')} variant="accent" onPress={() => void share()} />
        <View style={styles.buttons}>
          {isHost ? (
            <Button
              label={t('party.playAgain')}
              onPress={onPlayAgain}
              style={styles.grow}
              testID="party-again"
            />
          ) : null}
          <Button
            label={t('party.home')}
            variant="ghost-light"
            onPress={onHome}
            style={styles.grow}
            testID="party-home"
          />
        </View>
        {!isHost ? (
          <Text variant="caption" color={colors.borderStrong} align="center">
            {t('party.waitingAgain')}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.night },
  scroll: { flexGrow: 1, paddingTop: 20 },
  column: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', paddingHorizontal: 20 },
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 24 },
  step: { flex: 1, alignItems: 'center', gap: 4 },
  ring: { borderWidth: 3, borderColor: colors.borderStrong, borderRadius: 40, padding: 3 },
  ringGold: { borderColor: colors.gold },
  block: {
    alignSelf: 'stretch',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  place: { fontFamily: fonts.display, fontSize: 36, color: colors.white },
  placeFirst: { color: colors.ink },
  mvp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 20,
    padding: 16,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.gold,
    backgroundColor: '#2C2410',
  },
  grow: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#26352D',
  },
  rank: { width: 24 },
  points: { minWidth: 56, textAlign: 'right' },
  footer: { paddingTop: 12, paddingBottom: 16, gap: 10 },
  buttons: { flexDirection: 'row', gap: 10 },
});
