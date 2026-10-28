import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Icon } from './icons';
import { colors, CONTENT_MAX_WIDTH } from './theme';

interface Props {
  children: ReactNode;
  /** Pinned under the scrolling content, e.g. the main button. */
  footer?: ReactNode;
  /** Shows a back arrow that goes back, or to `backTo` when there is no history (a fresh web tab). */
  back?: boolean;
  backTo?: string;
  background?: string;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

/** A phone-width column, centred on wide screens (TRD FR-WEB-4), inside the safe area. */
export function Screen({
  children,
  footer,
  back = false,
  backTo = '/',
  background = colors.bg,
  scroll = true,
  contentStyle,
}: Props) {
  const body = (
    <View style={[styles.column, contentStyle]}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          onPress={() => (router.canGoBack() ? router.back() : router.replace(backTo))}
          style={styles.back}
        >
          <Icon name="back" size={28} />
        </Pressable>
      ) : null}
      {children}
    </View>
  );
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: background }]} edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        <View style={styles.scroll}>{body}</View>
      )}
      {footer ? <View style={[styles.column, styles.footer]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1 },
  column: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    flexGrow: 1,
  },
  footer: { flexGrow: 0, paddingTop: 12, paddingBottom: 16, gap: 12 },
  back: { width: 44, height: 44, justifyContent: 'center', marginLeft: -8, marginBottom: 8 },
});
