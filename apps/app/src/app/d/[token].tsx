/**
 * A duel link (whosabi.ng/d/{token}, mockup 28): who is challenging, then straight into the turn,
 * as a guest if need be, with no install and no sign-up (UX §2.2, TRD FR-WEB-1).
 */
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorMessage } from '../../api';
import { ensureSignedIn, useSession } from '../../auth/session';
import { duelKeys, duels } from '../../features/duels/api';
import { useT } from '../../i18n';
import { InitialAvatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

export default function Invite() {
  const t = useT();
  const { token } = useLocalSearchParams<{ token: string }>();
  const status = useSession((s) => s.status);
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => duels.invite(token!),
    enabled: Boolean(token),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      if ((await ensureSignedIn()) === 'account_device') {
        router.push({ pathname: '/sign-in', params: { reason: 'device' } });
        return;
      }
      const duel = await duels.accept(token!);
      queryClient.setQueryData(duelKeys.one(duel.id), duel);
      router.replace(`/duel/${duel.id}`);
    } catch (e) {
      // Says why: their own link, someone else took it, or it ran out of time.
      setError(errorMessage(e, t('error.network')));
      void preview.refetch();
    } finally {
      setBusy(false);
    }
  };

  const name = preview.data?.challenger.username ?? t('invite.aPlayer');
  const missing = preview.error instanceof ApiError && preview.error.status === 404;
  const open = preview.data?.status === 'open';
  const startOwn = () =>
    router.replace(status === 'guest' || status === 'account' ? '/challenge' : '/welcome');

  return (
    <Screen
      footer={
        open ? (
          <Button
            label={t('invite.accept')}
            trailingIcon="arrow-right"
            variant="accent"
            loading={busy || status === 'loading'}
            onPress={() => void accept()}
            testID="invite-accept"
          />
        ) : preview.data || missing ? (
          <Button label={t('invite.startOwn')} onPress={startOwn} />
        ) : null
      }
    >
      {preview.isPending ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} size="large" />
      ) : null}
      {preview.data ? (
        <View style={styles.card}>
          <InitialAvatar name={name} size={88} />
          <Text variant="display" align="center" accessibilityRole="header" testID="invite-title">
            {t('invite.title', { name })}
          </Text>
          <Text variant="bodySoft" align="center">
            {open
              ? t('invite.body')
              : preview.data.status === 'taken'
                ? t('invite.taken')
                : t('invite.closed')}
          </Text>
        </View>
      ) : null}
      {preview.isError ? (
        <View style={styles.card}>
          <Text variant="heading" align="center">
            {missing ? t('invite.missing') : errorMessage(preview.error, t('error.network'))}
          </Text>
          {missing ? null : <Button label={t('error.retry')} onPress={() => void preview.refetch()} />}
        </View>
      ) : null}
      {error ? (
        <Text variant="body" color={colors.wrongInk} align="center" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 80 },
  card: {
    alignItems: 'center',
    gap: 16,
    marginTop: 48,
    padding: 24,
    borderRadius: radius.card,
    backgroundColor: colors.accentTint,
  },
});
