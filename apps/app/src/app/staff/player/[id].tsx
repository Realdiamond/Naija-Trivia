/**
 * One player in the Staff tab: who they are, how they play, and their recent activity in plain
 * words (the console's User 360, doc 18 §7.2, cut to what fits a phone). Masked details stay
 * masked; revealing them is for the console, with a reason.
 */
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  describeEvent,
  routes,
  type AdminTimelineResponse,
  type AdminUserSummary,
} from '@whosabi/shared-types';
import { errorMessage } from '../../../api';
import { StaffGate } from '../../../features/staff/StaffGate';
import { staffGet } from '../../../features/staff/session';
import { Screen } from '../../../ui/Screen';
import { Text } from '../../../ui/Text';
import { colors, radius } from '../../../ui/theme';

const watTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Lagos',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso))
    : '—';

export default function StaffPlayer() {
  return (
    <StaffGate>
      <Player />
    </StaffGate>
  );
}

function Player() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const summary = useQuery({
    queryKey: ['staff', 'player', id],
    queryFn: () => staffGet<AdminUserSummary>(routes.admin.user(id)),
  });
  const timeline = useQuery({
    queryKey: ['staff', 'timeline', id],
    queryFn: () => staffGet<AdminTimelineResponse>(`${routes.admin.timeline(id)}?limit=60`),
  });
  const p = summary.data;

  return (
    <Screen back backTo="/staff/players">
      {summary.error ? (
        <Text variant="body" color={colors.wrongInk}>
          {errorMessage(summary.error, 'Could not load this player.')}
        </Text>
      ) : null}
      {p ? (
        <>
          <Text variant="title" testID="staff-player-name">
            {p.username ?? (p.status === 'guest' ? 'Guest' : 'No username')}
          </Text>
          <Text variant="caption" selectable>
            {p.id}
          </Text>
          <View style={styles.facts}>
            <Fact label="Status" value={p.status} />
            <Fact label="Level" value={`${p.level} · ${p.tier.name}`} />
            <Fact
              label="Duels"
              value={`${p.duels.won} won · ${p.duels.lost} lost · ${p.duels.active} going`}
            />
            <Fact label="Friends" value={String(p.friends)} />
            <Fact label="Plays on" value={p.last_platform ?? '—'} />
            <Fact label="Last seen" value={watTime(p.last_seen_at)} />
            <Fact label="Joined" value={watTime(p.created_at)} />
            <Fact
              label="Signs in with"
              value={p.sign_in_methods.map((m) => m.provider.replace('_', ' ')).join(', ') || '—'}
            />
          </View>
        </>
      ) : null}

      <Text variant="heading" style={styles.section}>
        Recent activity
      </Text>
      {timeline.data?.events.length === 0 ? <Text variant="bodySoft">Nothing yet.</Text> : null}
      {timeline.data?.events.map((e) => (
        <View key={e.event_id} style={styles.event}>
          <Text variant="caption" style={styles.time}>
            {watTime(e.ts)}
          </Text>
          <Text variant="body" style={styles.grow}>
            {describeEvent(e)}
          </Text>
        </View>
      ))}
    </Screen>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text variant="caption">{label}</Text>
      <Text variant="label">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  facts: {
    gap: 10,
    padding: 16,
    marginTop: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  section: { marginTop: 20, marginBottom: 4 },
  event: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  time: { width: 92 },
  grow: { flex: 1 },
});
