/**
 * The Daily result (mockup 16): score and time, the streak and its freeze, the grid by category,
 * how much of Naija you beat, your state, XP, the share box, then the answers and facts.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import type { DailyResult } from '@whosabi/shared-types';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { category, colors, fonts, radius } from '../../ui/theme';
import { STATE_NAMES } from '../profile/states';
import { PushPrompt } from '../push/PushPrompt';
import { DailyShare } from './DailyShare';

export function DailyResultView({ result }: { result: DailyResult }) {
  const t = useT();
  const [review, setReview] = useState(false);
  const { streak } = result;
  const stateName = (code: string | null) => (code ? STATE_NAMES[code as keyof typeof STATE_NAMES] : '');
  const freezeLine = streak.used_freeze
    ? t('daily.freezeSaved')
    : streak.freezes_left > 0
      ? t('daily.freezeLeft')
      : t('daily.freezeNone');

  return (
    <Screen
      back
      backTo="/home"
      contentStyle={styles.content}
      footer={<Button label={t('daily.challenge')} onPress={() => router.push('/challenge')} />}
    >
      <Text variant="display" accessibilityRole="header" testID="daily-title">
        {t('daily.title', { id: result.id })}
      </Text>

      <View style={styles.score}>
        <View style={styles.scoreSide}>
          <Text style={styles.big} testID="daily-score">
            {result.correct_count}/{result.total}
          </Text>
          <Text variant="body" color={colors.white}>
            {t('daily.seconds', { seconds: Math.round(result.total_ms / 1000) })}
          </Text>
        </View>
        <View style={styles.streak}>
          <View style={styles.streakLine}>
            <Icon name="flame" size={26} color={colors.gold} />
            <Text style={styles.streakDays} testID="daily-streak">
              {streak.current === 1 ? t('daily.day') : t('daily.days', { days: streak.current })}
            </Text>
          </View>
          <Text variant="caption" color={colors.white} align="right">
            {freezeLine}
          </Text>
        </View>
      </View>

      <View style={styles.grid} testID="daily-grid">
        {[...result.grid].map((cell, i) => {
          const right = cell === 'G';
          const label = i === result.total - 1 ? t('daily.boss') : category(result.categories[i]).short;
          return (
            <View key={i} style={styles.cell}>
              <View
                style={[styles.square, { backgroundColor: right ? colors.primaryInk : colors.wrongInk }]}
                accessibilityLabel={`${label}: ${right ? '✓' : '✗'}`}
              >
                <Icon name={right ? 'check' : 'cross'} size={22} color={colors.white} strokeWidth={3} />
              </View>
              <Text variant="caption" numberOfLines={1}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.cards}>
        <View style={[styles.card, { backgroundColor: colors.primaryTint }]}>
          {result.percentile === null ? (
            <Text variant="body">{t('daily.first')}</Text>
          ) : (
            <>
              <Text style={styles.cardBig} color={colors.primaryInk} testID="daily-percentile">
                {result.percentile}%
              </Text>
              <Text variant="body">{t('daily.percentile')}</Text>
            </>
          )}
        </View>
        {result.state || result.leading_state ? (
          <View style={[styles.card, { backgroundColor: colors.accentTint }]}>
            {result.state ? (
              <Text style={styles.cardBig}>#{result.state.rank.toLocaleString('en-NG')}</Text>
            ) : null}
            <Text variant="body">
              {[
                result.state ? t('daily.stateRank', { state: stateName(result.state.code) }) : '',
                result.leading_state ? t('daily.stateLeads', { state: stateName(result.leading_state) }) : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        ) : null}
      </View>

      <Text variant="bodySoft">{t('daily.xp', { xp: result.xp })}</Text>

      <DailyShare id={result.id} text={result.share_text} />
      <PushPrompt reason="daily" />

      <Button
        label={t('daily.leaderboards')}
        variant="outline"
        icon="trophy"
        onPress={() => router.push('/leaderboards')}
        testID="daily-leaderboards"
      />
      <Button
        label={review ? t('daily.hideAnswers') : t('daily.seeAnswers')}
        variant="link"
        size="medium"
        onPress={() => setReview(!review)}
        testID="daily-review"
      />

      {review ? (
        <View style={styles.review}>
          {result.review.map((item) => (
            <View key={item.seq} style={styles.reviewItem}>
              <View style={styles.reviewHead}>
                <Icon
                  name={item.correct ? 'check' : 'cross'}
                  size={18}
                  color={item.correct ? colors.correctInk : colors.wrongInk}
                  strokeWidth={3}
                />
                <Text variant="caption">
                  {item.seq === result.total ? t('daily.boss') : category(item.category_id).name}
                </Text>
              </View>
              <Text variant="body">{item.text}</Text>
              <Text variant="label" color={colors.primaryInk}>
                {t('daily.answer', { answer: item.answer })}
              </Text>
              {item.fact ? <Text variant="bodySoft">{item.fact}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  score: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 20,
    borderRadius: radius.card,
    backgroundColor: colors.night,
  },
  scoreSide: { gap: 2 },
  big: { fontFamily: fonts.display, fontSize: 56, lineHeight: 60, color: colors.white },
  streak: { flexShrink: 1, alignItems: 'flex-end', gap: 4 },
  streakLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  streakDays: { fontFamily: fonts.heavy, fontSize: 24, lineHeight: 30, color: colors.gold },
  grid: { flexDirection: 'row', gap: 6 },
  cell: { flex: 1, alignItems: 'center', gap: 6, minWidth: 0 },
  square: {
    width: '100%',
    aspectRatio: 1,
    maxWidth: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cards: { flexDirection: 'row', gap: 12 },
  card: { flex: 1, padding: 16, borderRadius: radius.card, gap: 4 },
  cardBig: { fontFamily: fonts.heavy, fontSize: 30, lineHeight: 36, color: colors.ink },
  review: { gap: 12 },
  reviewItem: {
    gap: 6,
    padding: 14,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
