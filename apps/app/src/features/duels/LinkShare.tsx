/** Sending a duel link: WhatsApp first (that is where Naija chats happen), then copy or share. */
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { trackEvent } from '../../analytics';
import { useT } from '../../i18n';
import { canShare, shareText } from '../../platform/share';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

export function LinkShare({ url }: { url: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const message = t('duel.shareMessage', { url });

  const whatsapp = () => {
    trackEvent('invite_shared', { channel: 'whatsapp', context: 'duel' });
    void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
  };
  const copy = async () => {
    await Clipboard.setStringAsync(url);
    trackEvent('invite_shared', { channel: 'copy', context: 'duel' });
    setCopied(true);
  };
  const share = async () => {
    if (await shareText(message, url)) trackEvent('invite_shared', { channel: 'web_share', context: 'duel' });
  };

  return (
    <View style={styles.card}>
      <Text variant="heading">{t('duel.linkTitle')}</Text>
      <Text variant="bodySoft">{t('duel.linkBody')}</Text>
      <View style={styles.url}>
        <Text variant="label" selectable numberOfLines={1} testID="invite-url">
          {url}
        </Text>
      </View>
      <Button label={t('duel.whatsapp')} onPress={whatsapp} testID="share-whatsapp" />
      <View style={styles.row}>
        <Button
          label={copied ? t('duel.copied') : t('duel.copy')}
          variant="outline"
          size="medium"
          onPress={() => void copy()}
          style={styles.half}
          testID="copy-link"
        />
        {canShare ? (
          <Button
            label={t('duel.share')}
            variant="outline"
            size="medium"
            onPress={() => void share()}
            style={styles.half}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.accentTint,
    marginTop: 16,
  },
  url: { padding: 12, borderRadius: radius.button, backgroundColor: colors.surface },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
});
