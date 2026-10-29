/**
 * Coins (GDD §5.1): the balance, how to earn more, and every coin earned or spent, newest first.
 * Opened from the coins on Home. Lifelines and the shop spend them (step 2.4).
 */
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import type { WalletEntry } from '@whosabi/shared-types';
import { errorMessage } from '../api';
import { useSession } from '../auth/session';
import { useWallet, useWalletHistory } from '../features/economy/api';
import { useT, type MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, fonts, radius } from '../ui/theme';

export default function Coins() {
  const t = useT();
  const status = useSession((s) => s.status);
  const signedIn = status === 'guest' || status === 'account';
  const wallet = useWallet(signedIn);
  const history = useWalletHistory(signedIn);

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Screen back backTo="/home" contentStyle={styles.content}>
      <Text variant="title" accessibilityRole="header">
        {t('coins.title')}
      </Text>

      <View style={styles.balance}>
        <Icon name="coin" size={36} color={colors.accentInk} />
        <View style={styles.grow}>
          <Text variant="overline" color={colors.accentInk}>
            {t('coins.balance')}
          </Text>
          <Text style={styles.amount} testID="coins-balance">
            {wallet.data ? wallet.data.coins.toLocaleString('en-NG') : '–'}
          </Text>
        </View>
      </View>
      <Text variant="bodySoft">{t('coins.how')}</Text>
      <Text variant="caption">{t('coins.soon')}</Text>

      <Text variant="heading" style={styles.section}>
        {t('coins.history')}
      </Text>
      {history.isPending ? <ActivityIndicator color={colors.primary} /> : null}
      {history.error ? (
        <Text variant="body" color={colors.wrongInk}>
          {errorMessage(history.error, t('error.network'))}
        </Text>
      ) : null}
      {history.isSuccess && entries.length === 0 ? (
        <Text variant="bodySoft" testID="coins-empty">
          {t('coins.empty')}
        </Text>
      ) : null}
      <View>
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </View>
      {history.hasNextPage ? (
        <Button
          label={t('coins.more')}
          variant="outline"
          loading={history.isFetchingNextPage}
          onPress={() => void history.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}

function EntryRow({ entry }: { entry: WalletEntry }) {
  const t = useT();
  const earned = entry.amount > 0;
  const when = new Date(entry.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  return (
    <View style={styles.row} testID="coins-entry">
      <View style={styles.grow}>
        <Text variant="body">
          {t(`coins.reason.${entry.reason}` as MessageKey, { ref: entry.ref_id ?? '' })}
        </Text>
        <Text variant="caption">{when}</Text>
      </View>
      <Text variant="label" color={earned ? colors.correctInk : colors.inkSoft}>
        {earned ? '+' : '−'}
        {Math.abs(entry.amount).toLocaleString('en-NG')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingBottom: 24 },
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: radius.card,
    backgroundColor: colors.accentTint,
  },
  grow: { flex: 1 },
  amount: { fontFamily: fonts.display, fontSize: 36, lineHeight: 42, color: colors.ink },
  section: { marginTop: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
