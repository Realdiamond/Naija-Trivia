/**
 * The shop (mockup 25, build plan step 2.4d): a short ad for 25 coins, and the coin packs from
 * Google Play through RevenueCat. The store shows the price the player pays; the coins arrive
 * when RevenueCat tells our server, so the wallet is looked at again for a few seconds after.
 * The starter pack, gems and the Sabi Pass come with v1.1; on the web, buying comes with Paystack.
 * Opening the shop and tapping buy tell the staff (step 2.9b). Staff can close the shop for a
 * while (a kill switch, step 2.7c).
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { routes, type CoinPackView, type ShopResponse } from '@whosabi/shared-types';
import { trackEvent } from '../analytics';
import { api } from '../api';
import { useSession } from '../auth/session';
import { PLATFORM } from '../config';
import { useWallet, walletKeys } from '../features/economy/api';
import { WatchAdCard } from '../features/economy/WatchAdCard';
import { useFlag } from '../features/liveops/config';
import { useT } from '../i18n';
import { buy, startStore, storeAvailable, storePrices } from '../purchases';
import { Icon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, fonts, radius } from '../ui/theme';

/** The payment journey for staff alerts; never in the way of buying. */
const tellStaff = (kind: 'opened' | 'started', sku?: string) =>
  void api.post(routes.shopEvents(), { kind, ...(sku ? { sku } : {}) }).catch(() => undefined);

export default function Shop() {
  const t = useT();
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.id);
  const signedIn = status === 'guest' || status === 'account';
  const wallet = useWallet(signedIn);
  const shopOn = useFlag('shop.enabled');
  const shop = useQuery({
    queryKey: ['shop'],
    queryFn: () => api.get<ShopResponse>(routes.shop()),
    enabled: signedIn,
  });
  const queryClient = useQueryClient();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [buying, setBuying] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    trackEvent('store_viewed', {});
    tellStaff('opened');
  }, [signedIn]);

  const skus = shop.data?.packs.map((p) => p.sku).join(',');
  useEffect(() => {
    if (!userId || !skus || !storeAvailable) return;
    let live = true;
    void startStore(userId)
      .then(() => storePrices(skus.split(',')))
      .then((found) => {
        if (live) setPrices(found);
      });
    return () => {
      live = false;
    };
  }, [userId, skus]);

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  const purchase = async (pack: CoinPackView) => {
    setBuying(pack.sku);
    setNote(null);
    trackEvent('purchase_started', { sku: pack.sku, price_ngn: pack.price_ngn });
    tellStaff('started', pack.sku);
    const outcome = await buy(pack.sku);
    setBuying(null);
    if (outcome === 'bought') {
      setNote(t('shop.onTheWay'));
      for (const ms of [1500, 4000, 9000]) {
        setTimeout(() => void queryClient.invalidateQueries({ queryKey: walletKeys.all }), ms);
      }
    } else if (outcome === 'failed' || outcome === 'unavailable') {
      trackEvent('purchase_failed', { sku: pack.sku, error: outcome });
      setNote(t('shop.failed'));
    }
  };

  const canBuy = storeAvailable && Object.keys(prices).length > 0;

  return (
    <Screen back backTo="/coins" contentStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header" style={styles.grow}>
          {t('shop.title')}
        </Text>
        <View style={styles.balance}>
          <Icon name="coin" size={18} color={colors.accentInk} />
          <Text variant="label" testID="shop-balance">
            {t('shop.balance', { coins: (wallet.data?.coins ?? 0).toLocaleString('en-NG') })}
          </Text>
        </View>
      </View>

      <WatchAdCard placement="shop" />

      <Text variant="heading" style={styles.section}>
        {t('shop.coins')}
      </Text>
      {!shopOn ? (
        <Text variant="body" align="center" testID="shop-closed">
          {t('shop.closed')}
        </Text>
      ) : null}
      <View style={styles.grid}>
        {shop.data?.packs.map((pack) => (
          <Pressable
            key={pack.sku}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canBuy, busy: buying === pack.sku }}
            disabled={!canBuy || buying !== null}
            onPress={() => void purchase(pack)}
            style={({ pressed }) => [
              styles.pack,
              pressed && styles.pressed,
              buying === pack.sku && styles.busy,
            ]}
            testID={`pack-${pack.sku}`}
          >
            <View style={styles.amountRow}>
              <Icon name="coin" size={22} color={colors.accentInk} />
              <Text style={styles.amount}>{pack.coins.toLocaleString('en-NG')}</Text>
            </View>
            <Text variant="label" color={colors.correctInk} style={styles.extra}>
              {pack.bonus_pct > 0 ? t('shop.extra', { pct: pack.bonus_pct }) : ' '}
            </Text>
            <Text variant="heading">{prices[pack.sku] ?? `₦${pack.price_ngn.toLocaleString('en-NG')}`}</Text>
          </Pressable>
        ))}
      </View>
      {note ? (
        <Text variant="body" align="center" accessibilityLiveRegion="polite" testID="shop-note">
          {note}
        </Text>
      ) : shopOn && !canBuy && shop.data ? (
        <Text variant="bodySoft" align="center" testID="shop-soon">
          {PLATFORM === 'web' ? t('shop.soonWeb') : t('shop.soonApp')}
        </Text>
      ) : null}
      <Text variant="caption" align="center">
        {t('shop.noCash')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 },
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.accentTint,
  },
  section: { marginTop: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  pack: {
    flexBasis: '45%',
    flexGrow: 1,
    gap: 4,
    padding: 16,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  amount: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.ink },
  extra: { minHeight: 20 },
  pressed: { opacity: 0.85 },
  busy: { opacity: 0.6 },
});
