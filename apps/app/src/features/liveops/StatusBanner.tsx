/**
 * The status banner staff put up from the console (doc 18 §11, step 2.7c): "Party rooms are
 * having issues. Duels still work." In Pidgin when the player chose it and staff wrote one.
 */
import { StyleSheet, View } from 'react-native';
import { useLanguage } from '../../i18n';
import { Icon } from '../../ui/icons';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';
import { useRemoteConfig } from './config';

export function StatusBanner() {
  const banner = useRemoteConfig().data?.banner;
  const language = useLanguage((s) => s.language);
  if (!banner) return null;
  const warning = banner.level === 'warning';
  return (
    <View
      style={[styles.banner, warning ? styles.warning : styles.info]}
      accessibilityRole="alert"
      testID="status-banner"
    >
      <Icon
        name={warning ? 'shield' : 'bell'}
        size={20}
        color={warning ? colors.accentInk : colors.primaryInk}
      />
      <Text variant="body" style={styles.text}>
        {language === 'pcm' && banner.text_pcm ? banner.text_pcm : banner.text_en}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: radius.card,
    marginBottom: 12,
  },
  warning: { backgroundColor: colors.accentTint },
  info: { backgroundColor: colors.primaryTint },
  text: { flex: 1 },
});
