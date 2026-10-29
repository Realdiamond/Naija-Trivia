/** The end of a duel (mockup 13): who won, round by round, the rating change and a rematch. */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { routes, type DuelView, type Me } from '@whosabi/shared-types';
import { useInterstitial } from '../../ads/useInterstitial';
import { trackEvent } from '../../analytics';
import { errorMessage } from '../../api';
import { useT } from '../../i18n';
import { Avatar, InitialAvatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { CategoryDot } from '../../ui/game';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { category, colors, CONTENT_MAX_WIDTH, fonts, radius } from '../../ui/theme';
import { SharePicture } from '../share/SharePicture';
import { duelKeys, duels } from './api';
import { useOpponentName } from './parts';
import { useRandomDuel } from './useRandomDuel';

export function DuelResult({ duel, onReview }: { duel: DuelView; onReview: () => void }) {
  const t = useT();
  const name = useOpponentName(duel);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const random = useRandomDuel('replace');
  const played = duel.state === 'complete' || duel.state === 'forfeit';
  // Every 3rd finished duel, an interstitial as the player leaves (step 2.4c).
  const leave = useInterstitial(played ? `duel:${duel.id}` : null);
  const { title, subtitle, background } = headline();
  // The Sabi Bot plays no rematches: a new random duel may find a person this time.
  const bot = duel.source === 'bot';
  const canRematch = played && duel.opponent !== null && !bot;

  function headline(): { title: string; subtitle: string; background: string } {
    if (duel.state === 'cancelled')
      return { title: t('duel.cancelled'), subtitle: '', background: colors.night };
    if (duel.state === 'declined') {
      // Only the challenged player (b) can decline.
      const title = duel.you === 'b' ? t('duel.youDeclined') : t('duel.declined', { name });
      return { title, subtitle: '', background: colors.night };
    }
    if (duel.result === 'win')
      return {
        title: t('duel.win'),
        subtitle: duel.state === 'forfeit' ? t('duel.forfeitWin', { name }) : t('duel.winSub'),
        background: colors.primary,
      };
    if (duel.result === 'loss')
      return {
        title: t('duel.loss'),
        subtitle: duel.state === 'forfeit' ? t('duel.forfeitLoss') : t('duel.lossSub'),
        background: colors.night,
      };
    return { title: t('duel.drawTitle'), subtitle: t('duel.drawSub'), background: colors.accentInk };
  }

  const rematch = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await duels.rematch(duel.id);
      queryClient.setQueryData(duelKeys.one(next.id), next);
      void queryClient.invalidateQueries({ queryKey: duelKeys.all });
      await leave(() => router.replace(`/duel/${next.id}`));
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <SafeAreaView edges={['top']} style={[styles.hero, { backgroundColor: background }]}>
          <View style={styles.column}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('duel.home')}
              hitSlop={12}
              onPress={() => void leave(() => router.replace('/home'))}
              style={styles.close}
            >
              <Icon name="cross" color={colors.white} size={28} />
            </Pressable>
            <Text
              variant="display"
              color={colors.white}
              align="center"
              style={styles.title}
              testID="result-title"
            >
              {title}
            </Text>
            {subtitle ? (
              <Text variant="body" color={colors.white} align="center">
                {subtitle}
              </Text>
            ) : null}
            {played ? (
              <View style={styles.players}>
                <View style={styles.player}>
                  <View style={styles.ring}>
                    <Avatar id={queryClient.getQueryData<Me>(['me'])?.avatar_id} size={72} />
                  </View>
                  <Text variant="label" color={colors.white}>
                    {t('duel.you')}
                  </Text>
                  <Text style={styles.score} color={colors.white} testID="result-you">
                    {duel.score.you.toLocaleString('en-NG')}
                  </Text>
                </View>
                <Text variant="label" color={colors.white} style={styles.to}>
                  {t('duel.to')}
                </Text>
                <View style={styles.player}>
                  <View style={styles.ring}>
                    <InitialAvatar name={name} size={72} />
                  </View>
                  <Text variant="label" color={colors.white} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.score} color={colors.white}>
                    {duel.score.opponent.toLocaleString('en-NG')}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        </SafeAreaView>

        <View style={styles.column}>
          {played ? (
            <>
              <Text variant="heading" style={styles.section}>
                {t('duel.roundByRound')}
              </Text>
              <View style={styles.tableHead}>
                <Text variant="caption" style={styles.cellWide}>
                  {t('duel.round')}
                </Text>
                <Text variant="caption" style={styles.cell}>
                  {t('duel.you')}
                </Text>
                <Text variant="caption" style={styles.cell} numberOfLines={1}>
                  {name}
                </Text>
              </View>
              {duel.rounds.map((round) => {
                const you = round.you.points;
                const them = round.opponent?.points ?? 0;
                const picker =
                  round.picked_by === 'opponent' ? t('duel.theirPick', { name }) : t('duel.yourPick');
                return (
                  <View key={round.round} style={styles.tableRow}>
                    <View style={[styles.cellWide, styles.roundName]}>
                      {round.category_id ? <CategoryDot id={round.category_id} /> : null}
                      <Text variant="body" numberOfLines={1}>
                        {round.category_id ? `${category(round.category_id).name} · ${picker}` : '—'}
                      </Text>
                    </View>
                    <Text
                      variant="label"
                      style={styles.cell}
                      color={you > them ? colors.correctInk : colors.inkSoft}
                    >
                      {you}
                    </Text>
                    <Text
                      variant="label"
                      style={styles.cell}
                      color={them > you ? colors.correctInk : colors.inkSoft}
                    >
                      {them}
                    </Text>
                  </View>
                );
              })}
              {bot ? (
                <Text variant="bodySoft" style={styles.section} testID="bot-note">
                  {t('duel.botNote')}
                </Text>
              ) : null}
              {duel.rating_delta !== null || duel.reward ? (
                <View style={styles.tiles} testID="duel-reward">
                  {duel.rating_delta !== null ? (
                    <View style={[styles.tile, { backgroundColor: colors.primaryTint }]}>
                      <Text variant="heading" color={colors.primaryInk}>
                        {duel.rating_delta >= 0 ? '+' : ''}
                        {Math.round(duel.rating_delta)}
                      </Text>
                      <Text variant="caption">{t('duel.rating')}</Text>
                    </View>
                  ) : null}
                  {duel.reward ? (
                    <>
                      <View style={[styles.tile, { backgroundColor: colors.accentTint }]}>
                        <Text variant="heading" testID="duel-coins">
                          +{duel.reward.coins}
                        </Text>
                        <Text variant="caption">{t('duel.coins')}</Text>
                      </View>
                      <View style={[styles.tile, { backgroundColor: XP_TINT }]}>
                        <Text variant="heading">+{duel.reward.xp}</Text>
                        <Text variant="caption">{t('duel.xp')}</Text>
                      </View>
                    </>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : null}

          {error || random.error ? (
            <Text variant="body" color={colors.wrongInk}>
              {error ?? random.error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {played ? (
              <SharePicture
                path={routes.shareDuelCard(duel.id)}
                fileName={`whosabi-duel-${duel.id}.png`}
                text={t('share.duelText')}
                onShared={() => trackEvent('invite_shared', { channel: 'status', context: 'duel' })}
                testID="duel-share-picture"
              />
            ) : null}
            {canRematch ? (
              <Button
                label={t('duel.rematch')}
                loading={busy}
                onPress={() => void rematch()}
                testID="rematch"
              />
            ) : null}
            {bot ? (
              <Button
                label={t('duel.newRandom')}
                loading={random.busy}
                onPress={() => void random.start()}
                testID="new-random"
              />
            ) : null}
            {played ? <Button label={t('duel.review')} variant="outline" onPress={onReview} /> : null}
            <Button
              label={t('duel.home')}
              variant="link"
              onPress={() => void leave(() => router.replace('/home'))}
              testID="result-home"
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** The XP tile's lilac (mockup 13). */
const XP_TINT = '#F0E8F7';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  hero: { paddingBottom: 28 },
  column: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', paddingHorizontal: 20 },
  close: { width: 44, height: 44, justifyContent: 'center', marginTop: 8 },
  title: { marginTop: 8 },
  players: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20, marginTop: 20 },
  player: { alignItems: 'center', gap: 4, maxWidth: 140 },
  ring: { borderWidth: 3, borderColor: colors.gold, borderRadius: 42, padding: 3 },
  to: { marginTop: 40 },
  score: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38 },
  section: { marginTop: 20, marginBottom: 8 },
  tableHead: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cellWide: { flex: 1 },
  roundName: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 8 },
  cell: { width: 72, textAlign: 'right' },
  tiles: { flexDirection: 'row', gap: 10, marginTop: 16 },
  tile: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderRadius: radius.card,
  },
  actions: { gap: 10, marginTop: 24, marginBottom: 16 },
});
