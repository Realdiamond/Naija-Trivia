/** List rows and section headings from the home, challenge and friends mockups (08, 09, 23). */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar, InitialAvatar } from './Avatar';
import { Text } from './Text';
import { colors, radius } from './theme';

interface PlayerRowProps {
  name: string;
  avatarId?: string | null;
  subtitle?: ReactNode;
  /** Buttons or a label on the right. */
  right?: ReactNode;
  /** Card style (the "Your turn" cards) instead of a divided list row. */
  card?: boolean;
  onPress?: () => void;
  testID?: string;
}

export function PlayerRow({
  name,
  avatarId,
  subtitle,
  right,
  card = false,
  onPress,
  testID,
}: PlayerRowProps) {
  const body = (
    <>
      {avatarId ? (
        <Avatar id={avatarId} size={card ? 52 : 44} />
      ) : (
        <InitialAvatar name={name} size={card ? 52 : 44} />
      )}
      <View style={styles.text}>
        <Text variant="label" style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {typeof subtitle === 'string' ? <Text variant="caption">{subtitle}</Text> : subtitle}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </>
  );
  const style = [styles.row, card ? styles.card : styles.divided];
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={style} testID={testID}>
      {body}
    </Pressable>
  ) : (
    <View style={style} testID={testID}>
      {body}
    </View>
  );
}

export function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <Text variant="heading" accessibilityRole="header" style={styles.section}>
      {title}
      {count !== undefined ? <Text variant="bodySoft"> ({count})</Text> : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  divided: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  card: {
    padding: 14,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: 12,
  },
  text: { flex: 1, gap: 2, minWidth: 0 },
  name: { fontSize: 17 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  section: { marginTop: 20, marginBottom: 8 },
});
