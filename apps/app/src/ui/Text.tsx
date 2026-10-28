import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { colors, fonts } from './theme';

/** The type scale of the mockups: Baloo 2 for big moments, Nunito for everything else. */
const variants = {
  hero: { fontFamily: fonts.display, fontSize: 64, lineHeight: 62, color: colors.white },
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, color: colors.ink },
  title: { fontFamily: fonts.heavy, fontSize: 28, lineHeight: 34, color: colors.ink },
  heading: { fontFamily: fonts.heavy, fontSize: 20, lineHeight: 26, color: colors.ink },
  body: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 23, color: colors.ink },
  bodySoft: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 23, color: colors.inkSoft },
  label: { fontFamily: fonts.heavy, fontSize: 15, lineHeight: 20, color: colors.ink },
  caption: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.muted },
  overline: {
    fontFamily: fonts.heavy,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
  },
} satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof variants;

interface Props extends TextProps {
  variant?: TextVariant;
  color?: string;
  align?: TextStyle['textAlign'];
}

export function Text({ variant = 'body', color, align, style, ...rest }: Props) {
  return (
    <RNText
      {...rest}
      style={[variants[variant], color ? { color } : null, align ? { textAlign: align } : null, style]}
    />
  );
}
