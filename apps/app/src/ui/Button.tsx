import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './icons';
import { Text } from './Text';
import { colors, fonts, radius } from './theme';

type Variant = 'primary' | 'accent' | 'outline' | 'dark' | 'light' | 'ghost-light' | 'link' | 'link-light';

const look: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: colors.white },
  accent: { bg: colors.accent, fg: colors.ink },
  outline: { bg: colors.surface, fg: colors.ink, border: colors.borderStrong },
  dark: { bg: colors.ink, fg: colors.white },
  light: { bg: colors.bg, fg: colors.primaryInk },
  'ghost-light': { bg: 'transparent', fg: colors.white, border: colors.white },
  link: { bg: 'transparent', fg: colors.primaryInk },
  'link-light': { bg: 'transparent', fg: colors.white },
};

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  /** Icon after the label, like the arrow on "Start playing". */
  trailingIcon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Shown as pressed-in, e.g. the chosen language. */
  selected?: boolean;
  size?: 'large' | 'medium';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  trailingIcon,
  loading = false,
  disabled = false,
  selected,
  size = 'large',
  style,
  testID,
}: Props) {
  const { bg, fg, border } = look[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading, selected }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        size === 'medium' && styles.medium,
        (variant === 'link' || variant === 'link-light') && styles.link,
        { backgroundColor: bg },
        border ? { borderWidth: 2, borderColor: border } : null,
        pressed && !inactive && styles.pressed,
        inactive && !loading && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} color={fg} size={22} /> : null}
          <Text
            style={[
              styles.label,
              size === 'medium' && styles.labelMedium,
              (variant === 'link' || variant === 'link-light') && styles.linkLabel,
            ]}
            color={fg}
          >
            {label}
          </Text>
          {trailingIcon ? <Icon name={trailingIcon} color={fg} size={22} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: radius.button + 4,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medium: { minHeight: 46, borderRadius: radius.button, paddingHorizontal: 16 },
  link: { minHeight: 44 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '100%' },
  label: { fontFamily: fonts.heavy, fontSize: 17, lineHeight: 23, flexShrink: 1, textAlign: 'center' },
  labelMedium: { fontSize: 16, lineHeight: 22 },
  linkLabel: { textDecorationLine: 'underline' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
});
