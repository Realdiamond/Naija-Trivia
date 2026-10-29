/**
 * A party game in progress (UX §2.3, mockup 19): the countdown, each question on the room's
 * clock, then the answer with what everyone picked and the top 5. The Wahala Round has its own
 * orange band. A big screen, or a host in screen mode, sees the same without answering.
 */
import { StyleSheet, View } from 'react-native';
import type { PartyQuestionMessage, PartyRoomState } from '@whosabi/shared-types';
import { useT, type MessageKey } from '../../i18n';
import { CategoryPill, OptionButton, TimerBar, type OptionState } from '../../ui/game';
import { Icon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors, fonts, radius } from '../../ui/theme';
import { useTimeLeft } from './parts';
import type { PartyView } from './useParty';

interface Props {
  room: PartyRoomState;
  view: PartyView;
  /** False for a big screen and a host in screen mode. */
  plays: boolean;
  serverNow: () => number;
  onAnswer: (question: PartyQuestionMessage, index: number) => void;
}

export function Countdown({ room, serverNow }: Pick<Props, 'room' | 'serverNow'>) {
  const t = useT();
  const left = useTimeLeft(room.ends_at, serverNow);
  return (
    <Screen background={colors.primary}>
      <View style={styles.center}>
        <Text variant="title" color={colors.white} align="center">
          {t('party.getReady')}
        </Text>
        <Text style={styles.count} accessibilityLiveRegion="polite" testID="party-countdown">
          {Math.max(1, Math.ceil(left / 1000))}
        </Text>
      </View>
    </Screen>
  );
}

function Band({ room, question }: { room: PartyRoomState; question: PartyQuestionMessage }) {
  const t = useT();
  const counter = t('party.questionOf', { n: question.index + 1, total: question.total });
  if (!question.wahala) {
    return (
      <View style={styles.plainBand}>
        <Text variant="label">{counter}</Text>
        <Text variant="caption">{t('party.roomLabel', { code: room.code })}</Text>
      </View>
    );
  }
  return (
    <View style={styles.wahalaBand} testID="party-wahala">
      <Text style={styles.wahalaTitle}>{t('party.wahala')}</Text>
      <Text variant="label">
        {t('party.double')} · {counter}
      </Text>
    </View>
  );
}

export function PartyQuestion({ room, view, plays, serverNow, onAnswer }: Props) {
  const t = useT();
  const q = view.question;
  const left = useTimeLeft(room.ends_at, serverNow);
  // Someone new waits for the next question; everyone gets this one's answer anyway.
  if (!q || q.index !== room.q_index) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="heading" align="center">
            {t('party.nextSoon')}
          </Text>
        </View>
      </Screen>
    );
  }
  const answered = room.players.filter((p) => p.answered).length;
  const locked = view.chosen !== null;
  return (
    <Screen scroll={false}>
      <Band room={room} question={q} />
      <View style={styles.questionBody}>
        <CategoryPill id={q.category_id} />
        <Text variant="title" accessibilityRole="header" testID="question-text">
          {q.text}
        </Text>
        <TimerBar remainingMs={left} limitMs={q.time_limit_ms} />
        <View style={styles.options}>
          {q.options.map((option, i) => (
            <OptionButton
              key={i}
              index={i}
              text={option}
              state={view.chosen === i ? 'chosen' : locked ? 'faded' : 'idle'}
              disabled={!plays || locked || left === 0}
              onPress={() => onAnswer(q, i)}
            />
          ))}
        </View>
        <Text variant="caption" align="center" testID="party-answered">
          {plays && locked
            ? t('party.lockedIn')
            : t('party.answeredCount', { n: answered, total: room.players.length })}
        </Text>
      </View>
    </Screen>
  );
}

export function PartyReveal({ room, view, plays }: Omit<Props, 'onAnswer' | 'serverNow'>) {
  const t = useT();
  const q = view.question;
  const reveal = view.reveal;
  if (!q || !reveal || reveal.qid !== q.qid) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text variant="heading" align="center">
            {t('party.nextSoon')}
          </Text>
        </View>
      </Screen>
    );
  }
  const total = Math.max(
    1,
    reveal.distribution.reduce((a, b) => a + b, 0),
  );
  const you = plays ? reveal.you : null;
  const board = view.board;
  return (
    <Screen>
      <Band room={room} question={q} />
      <View style={styles.questionBody}>
        <CategoryPill id={q.category_id} />
        <Text variant="heading">{q.text}</Text>
        <View style={styles.options}>
          {q.options.map((option, i) => {
            const share = Math.round((reveal.distribution[i]! / total) * 100);
            const right = i === reveal.correct_display_index;
            const mine = you?.display_index === i;
            const state: OptionState = right ? 'correct' : mine ? 'wrong' : 'faded';
            return (
              <View key={i} style={styles.revealRow}>
                <View style={styles.grow}>
                  <OptionButton
                    index={i}
                    text={mine ? `${option} · ${t('party.yourPick')}` : option}
                    state={state}
                    disabled
                    onPress={() => undefined}
                  />
                </View>
                <Text variant="label" style={styles.share}>
                  {share}%
                </Text>
              </View>
            );
          })}
        </View>
        {you ? (
          <View
            style={[styles.result, you.correct ? styles.resultRight : styles.resultWrong]}
            testID="party-result"
          >
            <Icon
              name={you.correct ? 'check' : 'cross'}
              color={you.correct ? colors.correctInk : colors.wrongInk}
            />
            <Text
              variant="label"
              style={styles.grow}
              color={you.correct ? colors.correctInk : colors.wrongInk}
            >
              {you.correct
                ? t('party.correct')
                : you.display_index === null
                  ? t('party.timeUp')
                  : t('party.wrong')}
            </Text>
            {you.correct ? (
              <Text variant="heading" color={colors.correctInk}>
                +{you.points}
              </Text>
            ) : null}
          </View>
        ) : null}
        {reveal.fact ? (
          <View style={styles.fact}>
            <Text variant="overline">{t('question.didYouKnow')}</Text>
            <Text variant="bodySoft">{reveal.fact}</Text>
          </View>
        ) : null}
        {board ? (
          <View style={styles.board} testID="party-board">
            <View style={styles.boardHead}>
              <Text variant="heading">{t('party.top5')}</Text>
              <Text variant="caption">{t(`party.next.${board.next}` as MessageKey)}</Text>
            </View>
            {board.top.map((row) => {
              const isYou = row.id === view.you?.id;
              return (
                <View key={row.id} style={[styles.boardRow, isYou && styles.boardYou]}>
                  <Text variant="label" style={styles.rank}>
                    {row.rank}
                  </Text>
                  <Text variant="body" style={styles.grow} numberOfLines={1}>
                    {isYou ? t('party.youName', { name: row.name }) : row.name}
                  </Text>
                  <Text
                    variant="caption"
                    color={row.move > 0 ? colors.correctInk : row.move < 0 ? colors.wrongInk : colors.muted}
                  >
                    {row.move > 0 ? `▲${row.move}` : row.move < 0 ? `▼${-row.move}` : '–'}
                  </Text>
                  <Text variant="label" style={styles.points}>
                    {row.score.toLocaleString('en-NG')}
                  </Text>
                </View>
              );
            })}
            {board.you && !board.top.some((r) => r.id === view.you?.id) ? (
              <View style={[styles.boardRow, styles.boardYou]}>
                <Text variant="label" style={styles.rank}>
                  {board.you.rank}
                </Text>
                <Text variant="body" style={styles.grow}>
                  {t('party.youName', { name: view.you?.name ?? '' })}
                </Text>
                <Text variant="label" style={styles.points}>
                  {board.you.score.toLocaleString('en-NG')}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  count: { fontFamily: fonts.display, fontSize: 120, lineHeight: 130, color: colors.white },
  plainBand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  wahalaBand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginHorizontal: -20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: colors.accent,
  },
  wahalaTitle: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.ink },
  questionBody: { gap: 16, paddingBottom: 16 },
  options: { gap: 10 },
  revealRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  share: { width: 44, textAlign: 'right' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.card },
  resultRight: { backgroundColor: colors.correctTint },
  resultWrong: { backgroundColor: colors.wrongTint },
  fact: { gap: 4, padding: 14, borderRadius: radius.card, backgroundColor: colors.sand },
  board: {
    gap: 6,
    padding: 14,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  boardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  boardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  boardYou: { backgroundColor: colors.primaryTint },
  rank: { width: 20 },
  points: { minWidth: 56, textAlign: 'right' },
});
