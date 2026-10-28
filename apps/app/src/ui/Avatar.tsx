import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from './Text';
import { colors, fonts } from './theme';

/**
 * The starter avatars (PRD F2): one figure in six colours. Outfits that unlock with levels come
 * with the economy in step 2.4; the ids stay the same.
 */
export const AVATARS = [
  { id: 'av_ankara_purple', color: '#8E44AD', name: 'Ankara' },
  { id: 'av_agbada_green', color: '#008751', name: 'Agbada' },
  { id: 'av_kaftan_blue', color: '#1F5F8B', name: 'Kaftan' },
  { id: 'av_gele_red', color: '#C0392B', name: 'Gele' },
  { id: 'av_buba_brown', color: '#7A5A1E', name: 'Buba' },
  { id: 'av_jersey_black', color: '#14231B', name: 'Jersey' },
] as const;

export type AvatarId = (typeof AVATARS)[number]['id'];

export const avatarColor = (id: string | null | undefined) =>
  AVATARS.find((a) => a.id === id)?.color ?? colors.primary;

/** A preset avatar: a person on a coloured disc. */
export function Avatar({ id, size = 56 }: { id: string | null | undefined; size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Circle cx={28} cy={28} r={28} fill={avatarColor(id)} />
      <Circle cx={28} cy={22} r={8} fill={colors.white} />
      <Path d="M12 48c3-8 9-12 16-12s13 4 16 12a28 28 0 0 1-32 0z" fill={colors.white} />
    </Svg>
  );
}

/** A player without an avatar yet: their initial on a colour picked from their name. */
export function InitialAvatar({ name, size = 48 }: { name: string; size?: number }) {
  const palette = ['#8E44AD', '#1F5F8B', '#7A5A1E', '#14231B', '#C0392B', '#008751'];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <View
      style={[
        styles.initial,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette[hash % palette.length],
        },
      ]}
    >
      <Text style={[styles.initialText, { fontSize: size * 0.42 }]} color={colors.white}>
        {name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  initial: { alignItems: 'center', justifyContent: 'center' },
  initialText: { fontFamily: fonts.heavy },
});
