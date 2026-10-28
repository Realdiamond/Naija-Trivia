/** The first-visit consent banner (TRD FR-WEB-11): one plain choice, never in the way of a question. */
import { StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, CONTENT_MAX_WIDTH, radius } from '../../ui/theme';
import { chooseConsent, useConsent } from './store';

export function ConsentBanner() {
  const t = useT();
  const { choice, loaded } = useConsent();
  if (!loaded || choice) return null;
  return (
    <View style={styles.wrap} accessibilityRole="alert" testID="consent-banner">
      <View style={styles.card}>
        <Text variant="label">{t('consent.title')}</Text>
        <Text variant="caption" color={colors.inkSoft}>
          {t('consent.body')}
        </Text>
        <View style={styles.row}>
          <Button
            label={t('consent.allow')}
            size="medium"
            onPress={() => void chooseConsent(true)}
            style={styles.button}
            testID="consent-allow"
          />
          <Button
            label={t('consent.necessary')}
            size="medium"
            variant="outline"
            onPress={() => void chooseConsent(false)}
            style={styles.button}
            testID="consent-necessary"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border, padding: 12 },
  card: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    gap: 8,
    borderRadius: radius.card,
  },
  row: { flexDirection: 'row', gap: 10 },
  button: { flex: 1 },
});
