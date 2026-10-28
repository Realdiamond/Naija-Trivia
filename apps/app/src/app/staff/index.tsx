/**
 * The Staff tab (build plan step 2.9): alerts, live numbers for today against yesterday, work
 * waiting, player lookup, and signing this phone out. Refreshes every 30 seconds while open, or on demand.
 */
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { routes, type AdminCount, type AdminOverview, type StaffAlertsResponse } from '@whosabi/shared-types';
import { errorMessage } from '../../api';
import { StaffGate } from '../../features/staff/StaffGate';
import { staffGet, staffSignOut, useStaff } from '../../features/staff/session';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';

export default function StaffHome() {
  return (
    <StaffGate>
      <LiveNumbers />
    </StaffGate>
  );
}

function LiveNumbers() {
  const admin = useStaff((s) => s.session?.admin);
  const overview = useQuery({
    queryKey: ['staff', 'overview'],
    queryFn: () => staffGet<AdminOverview>(routes.admin.overview()),
    refetchInterval: 30_000,
  });
  const alerts = useQuery({
    queryKey: ['staff', 'overview-alerts'],
    queryFn: () => staffGet<StaffAlertsResponse>(routes.admin.alerts()),
    refetchInterval: 30_000,
  });
  const unread = alerts.data?.unread ?? 0;
  const o = overview.data;

  return (
    <Screen
      back
      backTo="/home"
      footer={
        <Button
          label="Sign this phone out of staff tools"
          variant="link"
          onPress={() => void staffSignOut().then(() => router.replace('/home'))}
          testID="staff-sign-out"
        />
      }
    >
      <View style={styles.head}>
        <Icon name="shield" color={colors.primaryInk} />
        <Text variant="title" style={styles.grow}>
          Staff
        </Text>
        <Text variant="caption">{admin?.name}</Text>
      </View>

      <Button
        label={unread > 0 ? `Alerts · ${unread} new` : 'Alerts'}
        variant={unread > 0 ? 'accent' : 'outline'}
        icon="bell"
        onPress={() => router.push('/staff/alerts')}
        testID="staff-alerts"
      />
      {overview.error ? (
        <Text variant="body" color={colors.wrongInk}>
          {errorMessage(overview.error, 'Could not load the numbers. Tap Refresh to try again.')}
        </Text>
      ) : null}

      {o ? (
        <>
          <View style={styles.online} testID="staff-online">
            <Text variant="display" color={colors.white}>
              {o.online_now.toLocaleString('en-NG')}
            </Text>
            <Text variant="label" color={colors.white}>
              playing now (last 10 minutes)
            </Text>
          </View>

          <Button
            label="Look up a player"
            variant="outline"
            icon="search"
            onPress={() => router.push('/staff/players')}
            testID="staff-players"
          />
          <Text variant="heading" style={styles.section}>
            Today so far
          </Text>
          <Text variant="caption">Against yesterday up to the same time</Text>
          <View style={styles.grid}>
            <Tile label="New players" count={o.new_players} />
            <Tile label="Sign-ups" count={o.signups} />
            <Tile label="Duels started" count={o.duels_started} />
            <Tile label="Duels finished" count={o.duels_finished} />
            <Tile label="Daily players" count={o.daily_players} />
          </View>

          <Text variant="heading" style={styles.section}>
            Waiting on the team
          </Text>
          <View style={styles.grid}>
            <Plain label="Reported questions" value={o.waiting.reported_questions} alert />
            <Plain label="Questions in review" value={o.waiting.in_review} />
            <Plain label="Approved, not live" value={o.waiting.approved} />
          </View>
          <Text variant="caption">
            Updated{' '}
            {new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', timeStyle: 'short' }).format(
              new Date(o.at),
            )}
          </Text>
        </>
      ) : null}
      <Button
        label="Refresh"
        variant="link"
        size="medium"
        loading={overview.isFetching}
        onPress={() => void overview.refetch()}
      />
    </Screen>
  );
}

function Tile({ label, count }: { label: string; count: AdminCount }) {
  const diff = count.today - count.yesterday;
  return (
    <View style={styles.tile}>
      <Text variant="caption">{label}</Text>
      <Text variant="title">{count.today.toLocaleString('en-NG')}</Text>
      <Text
        variant="caption"
        color={diff > 0 ? colors.correctInk : diff < 0 ? colors.wrongInk : colors.inkSoft}
      >
        {diff > 0 ? '▲' : diff < 0 ? '▼' : '='} {count.yesterday.toLocaleString('en-NG')} yesterday
      </Text>
    </View>
  );
}

function Plain({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <View style={styles.tile}>
      <Text variant="caption">{label}</Text>
      <Text variant="title" color={alert && value > 0 ? colors.wrongInk : colors.ink}>
        {value.toLocaleString('en-NG')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  online: {
    alignItems: 'center',
    gap: 2,
    padding: 20,
    marginTop: 8,
    borderRadius: radius.card,
    backgroundColor: colors.primary,
  },
  section: { marginTop: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 8 },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    padding: 14,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
