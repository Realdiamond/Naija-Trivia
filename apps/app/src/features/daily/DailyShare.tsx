/** "Share your result" (mockup 16): the emoji grid on WhatsApp first, then X or a copy. */
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { trackEvent } from '../../analytics';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

export function DailyShare({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const open = (channel: 'whatsapp' | 'x', url: string) => {
    trackEvent('daily_shared', { channel });
    void Linking.openURL(url);
  };
  const copy = async () => {
    await Clipboard.setStringAsync(text);
    trackEvent('daily_shared', { channel: 'copy' });
    setCopied(true);
  };

  return (
    <View style={styles.card}>
      <Text variant="heading">{t('daily.shareTitle')}</Text>
      <View style={styles.text}>
        <Text variant="body" selectable testID="daily-share-text">
          {text}
        </Text>
      </View>
      <Text variant="caption">{t('daily.shareNote')}</Text>
      <View style={styles.row}>
        <Button
          label={t('daily.whatsapp')}
          variant="accent"
          size="medium"
          style={styles.button}
          onPress={() => open('whatsapp', `https://wa.me/?text=${encodeURIComponent(text)}`)}
          testID="daily-share-whatsapp"
        />
        <Button
          label={t('daily.x')}
          variant="outline"
          size="medium"
          style={styles.button}
          onPress={() => open('x', `https://x.com/intent/post?text=${encodeURIComponent(text)}`)}
        />
        <Button
          label={copied ? t('daily.copied') : t('daily.copy')}
          variant="outline"
          size="medium"
          style={styles.button}
          onPress={() => void copy()}
          testID="daily-share-copy"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    padding: 16,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: { padding: 14, borderRadius: radius.button, backgroundColor: colors.sand },
  row: { flexDirection: 'row', gap: 10 },
  button: { flex: 1 },
});
