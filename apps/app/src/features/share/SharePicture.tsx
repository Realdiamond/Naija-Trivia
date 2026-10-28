/** "Share picture for Status" (mockup 14): the API draws the picture, the phone or browser shares it. */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { errorMessage } from '../../api';
import { useT } from '../../i18n';
import { shareImage } from '../../platform/shareImage';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors } from '../../ui/theme';

interface Props {
  /** The API path of the picture, e.g. routes.shareDuelCard(id). */
  path: string;
  fileName: string;
  /** Goes with the picture where the share sheet takes text. */
  text: string;
  /** Called once the picture is shared or saved, for analytics. */
  onShared: () => void;
  variant?: 'accent' | 'outline';
  testID?: string;
}

export function SharePicture({ path, fileName, text, onShared, variant = 'accent', testID }: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);

  const share = async () => {
    setBusy(true);
    setNote(null);
    try {
      const outcome = await shareImage(path, fileName, text);
      if (outcome !== 'cancelled') onShared();
      if (outcome === 'saved') setNote({ text: t('share.saved'), error: false });
    } catch (e) {
      setNote({ text: errorMessage(e, t('share.failed')), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Button
        label={busy ? t('share.making') : t('share.picture')}
        variant={variant}
        loading={busy}
        onPress={() => void share()}
        testID={testID}
      />
      {note ? (
        <Text
          variant="caption"
          color={note.error ? colors.wrongInk : colors.inkSoft}
          align="center"
          testID={testID ? `${testID}-note` : undefined}
        >
          {note.text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 6 },
});
