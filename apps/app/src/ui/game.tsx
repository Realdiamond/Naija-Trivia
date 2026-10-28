/**
 * Question-screen pieces shared by the taste test, duels and later the Daily: the category pill,
 * the progress segments, the timer bar and the answer buttons (mockups 02 and 11).
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from './icons';
import { Text } from './Text';
import { category, colors, fonts, radius } from './theme';

export function CategoryPill({ id }: { id: string }) {
  const c = category(id);
  return (
    <View style={[styles.pill, { backgroundColor: c.tint }]}>
      <View style={[styles.dot, { backgroundColor: c.color }]} />
      <Text variant="label">{c.name}</Text>
    </View>
  );
}

export function CategoryDot({ id, size = 12 }: { id: string; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: category(id).color }}
    />
  );
}

/** One bar per question: done ones filled, the rest sand. */
export function ProgressSegments({ total, done }: { total: number; done: number }) {
  return (
    <View style={styles.segments} accessibilityElementsHidden importantForAccessibility="no">
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.segment, i < done && styles.segmentDone]} />
      ))}
    </View>
  );
}

/** Time left; turns orange in the last third. */
export function TimerBar({ remainingMs, limitMs }: { remainingMs: number; limitMs: number }) {
  const fraction = Math.max(0, Math.min(1, remainingMs / limitMs));
  const seconds = Math.ceil(remainingMs / 1000);
  const fill = fraction > 1 / 3 ? colors.primary : colors.accent;
  return (
    <View
      style={styles.timer}
      accessibilityRole="progressbar"
      accessibilityLabel={`${seconds} seconds left`}
      accessibilityValue={{ min: 0, max: Math.round(limitMs / 1000), now: seconds }}
    >
      <Icon name="timer" color={colors.inkSoft} />
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: fill }]} />
      </View>
      <Text variant="label" style={styles.seconds}>
        {seconds}s
      </Text>
    </View>
  );
}

export type OptionState = 'idle' | 'chosen' | 'correct' | 'wrong' | 'faded';

interface OptionProps {
  index: number;
  text: string;
  state: OptionState;
  disabled: boolean;
  onPress: () => void;
  /** Shows the number key that picks it, on computers (FR-WEB-5). */
  keyHint?: boolean;
}

const LETTERS = ['A', 'B', 'C', 'D'];

const optionLook: Record<OptionState, { bg: string; border: string; badge: string; badgeText: string }> = {
  idle: { bg: colors.surface, border: colors.border, badge: colors.sand, badgeText: colors.ink },
  chosen: { bg: colors.primaryTint, border: colors.primary, badge: colors.primary, badgeText: colors.white },
  correct: { bg: colors.correctTint, border: colors.correct, badge: colors.correct, badgeText: colors.white },
  wrong: { bg: colors.wrongTint, border: colors.wrong, badge: colors.wrong, badgeText: colors.white },
  faded: { bg: colors.surface, border: colors.border, badge: colors.sand, badgeText: colors.muted },
};

export function OptionButton({ index, text, state, disabled, onPress, keyHint = false }: OptionProps) {
  const look = optionLook[state];
  const letter = LETTERS[index] ?? String(index + 1);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${letter}: ${text}`}
      accessibilityState={{ disabled, selected: state === 'chosen' }}
      disabled={disabled}
      onPress={onPress}
      testID={`option-${index}`}
      style={({ pressed }) => [
        styles.option,
        { backgroundColor: look.bg, borderColor: look.border },
        state === 'faded' && styles.faded,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={[styles.badge, { backgroundColor: look.badge }]}>
        {state === 'correct' ? (
          <Icon name="check" color={colors.white} size={20} strokeWidth={3} />
        ) : state === 'wrong' ? (
          <Icon name="cross" color={colors.white} size={18} strokeWidth={3} />
        ) : (
          <Text style={styles.letter} color={look.badgeText}>
            {letter}
          </Text>
        )}
      </View>
      <Text style={styles.optionText}>{text}</Text>
      {keyHint ? (
        <View style={styles.keyHint}>
          <Text variant="caption">{index + 1}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  segments: { flexDirection: 'row', gap: 6 },
  segment: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#E5DFCF' },
  segmentDone: { backgroundColor: colors.primary },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: '#EEE8DA', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5 },
  seconds: { minWidth: 32, textAlign: 'right' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.card,
    borderWidth: 2,
  },
  faded: { opacity: 0.55 },
  pressed: { opacity: 0.85 },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  letter: { fontFamily: fonts.heavy, fontSize: 15 },
  optionText: { flex: 1, fontFamily: fonts.bold, fontSize: 17, lineHeight: 23 },
  keyHint: {
    minWidth: 24,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    alignItems: 'center',
  },
});
