/**
 * Staff alerts (build plan step 2.9b): problems, sign-ups and payments, newest first. Opening the
 * list marks them seen; each opens the player it is about, where there is one.
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { routes, type StaffAlert, type StaffAlertsResponse } from '@whosabi/shared-types';
import { errorMessage } from '../../api';
import { pushTarget } from '../../features/push/target';
import { StaffGate } from '../../features/staff/StaffGate';
import { staffGet, staffSend } from '../../features/staff/session';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors } from '../../ui/theme';

export default function StaffAlerts() {
  return (
    <StaffGate>
      <Alerts />
    </StaffGate>
  );
}

const KIND_ICON: Record<StaffAlert['kind'], string> = {
  problem: '⚠️',
  signup: '🎉',
  payment_opened: '👀',
  payment_started: '💳',
  payment_paid: '💰',
};

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

function Alerts() {
  const queryClient = useQueryClient();
  const alerts = useQuery({
    queryKey: ['staff', 'alerts'],
    queryFn: () => staffGet<StaffAlertsResponse>(routes.admin.alerts()),
    refetchInterval: 30_000,
  });
  const newest = alerts.data?.alerts[0]?.id;

  // Seen once they are on screen; the badge on the Staff tab clears too.
  useEffect(() => {
    if (!newest || !alerts.data?.unread) return;
    void staffSend('POST', routes.admin.alertsSeen(), { up_to: Number(newest) }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['staff', 'overview-alerts'] }),
    );
  }, [newest, alerts.data?.unread, queryClient]);

  return (
    <Screen back backTo="/staff">
      <View style={styles.head}>
        <Text variant="title" style={styles.grow}>
          Alerts
        </Text>
        <Button
          label="Settings"
          variant="link"
          size="medium"
          onPress={() => router.push('/staff/alert-settings')}
          testID="staff-alert-settings"
        />
      </View>
      {alerts.error ? (
        <Text variant="body" color={colors.wrongInk}>
          {errorMessage(alerts.error, 'Could not load alerts.')}
        </Text>
      ) : null}
      {alerts.data?.alerts.length === 0 ? (
        <Text variant="bodySoft">Nothing yet. Problems, sign-ups and payments will show here.</Text>
      ) : null}
      {alerts.data?.alerts.map((a) => {
        const opens = a.url ? pushTarget({ url: a.url }).url : '/home';
        const tappable = opens.startsWith('/staff/player/');
        return (
          <Pressable
            key={a.id}
            accessibilityRole={tappable ? 'button' : undefined}
            disabled={!tappable}
            onPress={() => router.push(opens as Parameters<typeof router.push>[0])}
            style={[styles.row, a.unread && styles.unread]}
          >
            <Text style={styles.icon}>{KIND_ICON[a.kind]}</Text>
            <View style={styles.grow}>
              <Text variant="label">{a.title}</Text>
              <Text variant="body">{a.body}</Text>
              <Text variant="caption">{when(a.created_at)}</Text>
            </View>
            {tappable ? <Icon name="chevron-right" color={colors.inkSoft} /> : null}
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  unread: { backgroundColor: colors.primaryTint },
  icon: { fontSize: 26 },
});
