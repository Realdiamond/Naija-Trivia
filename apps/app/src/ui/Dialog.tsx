/** A small confirm dialog, e.g. "Leave this round?". */
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { Text } from './Text';
import { colors, radius } from './theme';

interface Props {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

export function Dialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  testID,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.center}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel={cancelLabel} />
        <View style={styles.card} accessibilityRole="alert" testID={testID}>
          <Text variant="heading">{title}</Text>
          <Text variant="bodySoft">{body}</Text>
          <Button label={cancelLabel} onPress={onCancel} testID={testID ? `${testID}-cancel` : undefined} />
          <Button
            label={confirmLabel}
            variant="outline"
            onPress={onConfirm}
            testID={testID ? `${testID}-confirm` : undefined}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(14, 26, 20, 0.5)',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    gap: 12,
    padding: 20,
    borderRadius: radius.card,
    backgroundColor: colors.bg,
  },
});
