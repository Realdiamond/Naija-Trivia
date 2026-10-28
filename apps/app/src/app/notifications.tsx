/**
 * Notifications (build plan step 2.5c): whether this phone or browser gets them, how to turn them
 * on, and a switch for each kind. Browsers have no notification channels like Android's, so the
 * switches are the game's own; they count wherever the player is signed in.
 */
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { routes, type Me, type PushKind } from '@whosabi/shared-types';
import { api, errorMessage } from '../api';
import { useSession } from '../auth/session';
import { useT, type MessageKey } from '../i18n';
import { enablePush, needsHomeScreen, pushPermission, type PushPermission } from '../platform/push';
import { Button } from '../ui/Button';
import { Icon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, radius } from '../ui/theme';

const KINDS: Array<{ kind: PushKind; label: MessageKey; hint: MessageKey }> = [
  { kind: 'duels', label: 'notify.duels', hint: 'notify.duelsHint' },
  { kind: 'friends', label: 'notify.friends', hint: 'notify.friendsHint' },
  { kind: 'daily', label: 'notify.daily', hint: 'notify.dailyHint' },
];

const web = Platform.OS === 'web';

export default function Notifications() {
  const t = useT();
  const queryClient = useQueryClient();
  const signedIn = useSession((s) => s.status === 'guest' || s.status === 'account');
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>(routes.me()), enabled: signedIn });
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void pushPermission().then(setPermission);
  }, []);

  const save = useMutation({
    mutationFn: (pushOff: PushKind[]) =>
      api.request<Me>('PATCH', routes.me(), { body: { push_off: pushOff } }),
    // The switch moves at once; the answer (or a reload after a failure) settles it.
    onMutate: (pushOff) =>
      queryClient.setQueryData<Me>(['me'], (old) => old && { ...old, push_off: pushOff }),
    onSuccess: (data) => queryClient.setQueryData(['me'], data),
    onError: () => void queryClient.invalidateQueries({ queryKey: ['me'] }),
  });

  const turnOn = async () => {
    setBusy(true);
    setPermission(await enablePush().catch(() => 'denied' as const));
    setBusy(false);
  };

  const off = me.data?.push_off ?? [];
  const status: MessageKey | null =
    permission === 'granted'
      ? 'notify.on'
      : permission === 'undetermined'
        ? 'notify.offHere'
        : permission === 'denied'
          ? web
            ? 'notify.blockedWeb'
            : 'notify.blocked'
          : permission === 'unsupported'
            ? needsHomeScreen
              ? 'notify.iphone'
              : 'notify.unsupported'
            : null;

  return (
    <Screen back>
      <View style={styles.body}>
        <Text variant="display" accessibilityRole="header">
          {t('notify.title')}
        </Text>

        {status ? (
          <View style={[styles.card, permission === 'granted' && styles.cardOn]} testID="notify-status">
            <View style={styles.head}>
              <Icon name="bell" color={colors.primaryInk} />
              <Text variant="body" style={styles.grow}>
                {t(status)}
              </Text>
            </View>
            {permission === 'undetermined' ? (
              <Button
                label={t('push.turnOn')}
                size="medium"
                loading={busy}
                onPress={() => void turnOn()}
                testID="notify-turn-on"
              />
            ) : null}
          </View>
        ) : null}

        <Text variant="heading">{t('notify.kinds')}</Text>
        {save.error ? (
          <Text variant="body" color={colors.wrongInk}>
            {errorMessage(save.error, t('error.network'))}
          </Text>
        ) : null}
        <View>
          {KINDS.map(({ kind, label, hint }) => (
            <View key={kind} style={styles.row}>
              <View style={styles.grow}>
                <Text variant="label">{t(label)}</Text>
                <Text variant="caption">{t(hint)}</Text>
              </View>
              <Switch
                value={!off.includes(kind)}
                disabled={!me.data}
                onValueChange={(on) =>
                  save.mutate(on ? off.filter((k) => k !== kind) : [...off.filter((k) => k !== kind), kind])
                }
                trackColor={{ true: colors.primary, false: colors.borderStrong }}
                accessibilityLabel={t(label)}
                testID={`notify-${kind}`}
              />
            </View>
          ))}
        </View>
        <Text variant="caption">{t('notify.quiet')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: 18 },
  card: { gap: 12, padding: 16, borderRadius: radius.card, backgroundColor: colors.accentTint },
  cardOn: { backgroundColor: colors.primaryTint },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
