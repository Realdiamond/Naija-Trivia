import { useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Text } from './Text';
import { colors, fonts, radius } from './theme';

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  hint?: string;
  error?: string | null;
  /** Shown in a box before the input, like "+234". */
  prefix?: string;
  /** Shown at the end of the input, like the green tick of an available username. */
  trailing?: ReactNode;
  hintColor?: string;
}

export function Field({ label, hint, error, prefix, trailing, hintColor, ...input }: Props) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.wrong : focused ? colors.primary : colors.borderStrong;
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      <View style={[styles.box, { borderColor }]}>
        {prefix ? (
          <View style={styles.prefix}>
            <Text variant="label" style={styles.prefixText}>
              {prefix}
            </Text>
          </View>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={styles.input}
        />
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {error ? (
        <Text variant="caption" color={colors.wrongInk} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color={hintColor}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: radius.button + 4,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    minHeight: 58,
  },
  prefix: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: colors.sand,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  prefixText: { fontSize: 18 },
  input: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.bold,
    fontSize: 18,
    color: colors.ink,
  },
  trailing: { paddingRight: 14 },
});
