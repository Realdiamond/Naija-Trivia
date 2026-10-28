/** The taste test result (mockup 03), with the offer to save progress. */
import { StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useSession } from '../auth/session';
import { SignInOptions } from '../features/auth/SignInOptions';
import { useTasteResult } from '../features/taste/store';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { CategoryDot } from '../ui/game';
import { Icon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { category, colors, fonts, radius } from '../ui/theme';

export default function TasteResult() {
  const t = useT();
  const summary = useTasteResult((s) => s.summary);
  const status = useSession((s) => s.status);

  // Opened directly (a reload on the web): the result was only in memory.
  if (!summary) return <Redirect href="/" />;

  const headline =
    summary.correct * 3 >= summary.total * 2
      ? t('taste.result.great')
      : summary.correct > 0
        ? t('taste.result.good')
        : t('taste.result.low');

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.circle} testID="taste-score">
          <Text style={styles.circleScore} color={colors.white}>
            {summary.correct}/{summary.total}
          </Text>
          <Text variant="label" color={colors.white}>
            {t('taste.result.correct')}
          </Text>
        </View>
        <Text variant="display" align="center" accessibilityRole="header">
          {headline}
        </Text>
        <Text variant="bodySoft" align="center">
          {t('taste.result.points', { points: summary.score.toLocaleString('en-NG') })}
        </Text>
      </View>

      <View style={styles.list}>
        {summary.items.map((item, i) => (
          <View key={i} style={[styles.item, i > 0 && styles.itemBorder]}>
            <CategoryDot id={item.categoryId} size={14} />
            <View style={styles.itemText}>
              <Text variant="caption" color={colors.inkSoft}>
                {category(item.categoryId).name}
              </Text>
              <Text variant="body">{item.line}</Text>
            </View>
            <View style={styles.points}>
              <Icon
                name={item.correct ? 'check' : 'cross'}
                color={item.correct ? colors.correctInk : colors.wrongInk}
                size={20}
                strokeWidth={2.5}
              />
              <Text variant="heading" color={item.correct ? colors.correctInk : colors.wrongInk}>
                {item.correct ? `+${item.points}` : '0'}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {status === 'account' ? (
        <Button
          label={t('taste.result.continue')}
          onPress={() => router.replace('/')}
          style={styles.continue}
        />
      ) : (
        <View style={styles.save}>
          <Text variant="heading">{t('taste.result.save')}</Text>
          <Text variant="bodySoft">{t('taste.result.saveNote')}</Text>
          <SignInOptions />
          <Button
            label={t('taste.result.later')}
            variant="link"
            onPress={() => router.replace('/home')}
            testID="later"
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 10, paddingTop: 8 },
  circle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  circleScore: { fontFamily: fonts.display, fontSize: 44, lineHeight: 50 },
  list: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  itemBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  itemText: { flex: 1, gap: 2 },
  points: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  save: {
    marginTop: 24,
    marginBottom: 16,
    padding: 16,
    gap: 12,
    borderRadius: radius.card,
    backgroundColor: colors.accentTint,
  },
  continue: { marginTop: 24 },
});
