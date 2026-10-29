/**
 * The player's friend code (step 2.12): a QR code friends scan with their phone's camera, and the
 * link to send on WhatsApp. Either opens whosabi.ng/u/{username}, where they add the player.
 */
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SvgXml } from 'react-native-svg';
import { useQuery } from '@tanstack/react-query';
import { routes, type FriendCode as Code } from '@whosabi/shared-types';
import { trackEvent } from '../../analytics';
import { api } from '../../api';
import { useT } from '../../i18n';
import { canShare, shareText } from '../../platform/share';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

export function FriendCode() {
  const t = useT();
  const code = useQuery({
    queryKey: ['friend-code'],
    queryFn: () => api.get<Code>(routes.meFriendCode()),
    staleTime: Infinity,
  });
  const [copied, setCopied] = useState(false);
  if (!code.data) return null;
  const { url, svg } = code.data;
  const message = t('code.shareMessage', { url });

  return (
    <View style={styles.card} testID="friend-code">
      <Text variant="heading">{t('code.title')}</Text>
      <Text variant="bodySoft">{t('code.body')}</Text>
      <View style={styles.qr}>
        <SvgXml xml={svg} width={168} height={168} />
      </View>
      <Text variant="label" selectable numberOfLines={1} align="center" testID="friend-code-url">
        {url}
      </Text>
      <Button
        label={t('duel.whatsapp')}
        onPress={() => {
          trackEvent('invite_shared', { channel: 'whatsapp', context: 'profile' });
          void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
        }}
      />
      <View style={styles.row}>
        <Button
          label={copied ? t('duel.copied') : t('duel.copy')}
          variant="outline"
          size="medium"
          style={styles.half}
          onPress={() =>
            void Clipboard.setStringAsync(url).then(() => {
              trackEvent('invite_shared', { channel: 'copy', context: 'profile' });
              setCopied(true);
            })
          }
          testID="friend-code-copy"
        />
        {canShare ? (
          <Button
            label={t('duel.share')}
            variant="outline"
            size="medium"
            style={styles.half}
            onPress={() =>
              void shareText(message, url).then((shared) => {
                if (shared) trackEvent('invite_shared', { channel: 'web_share', context: 'profile' });
              })
            }
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  qr: {
    alignSelf: 'center',
    padding: 8,
    borderRadius: radius.card,
    backgroundColor: colors.white,
  },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
});
