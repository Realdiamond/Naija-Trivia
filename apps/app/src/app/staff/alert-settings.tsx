/** Which staff alerts reach this person's phones (step 2.9b). Everything starts on. */
import { StyleSheet, Switch, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { routes, type StaffAlertSettingsResponse } from '@whosabi/shared-types';
import { errorMessage } from '../../api';
import { StaffGate } from '../../features/staff/StaffGate';
import { staffGet, staffSend } from '../../features/staff/session';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors } from '../../ui/theme';

export default function StaffAlertSettings() {
  return (
    <StaffGate>
      <Settings />
    </StaffGate>
  );
}

function Settings() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['staff', 'alert-settings'],
    queryFn: () => staffGet<StaffAlertSettingsResponse>(routes.admin.alertSettings()),
  });
  const change = useMutation({
    mutationFn: (body: { kind: string; enabled: boolean }) =>
      staffSend<StaffAlertSettingsResponse>('PUT', routes.admin.alertSettings(), body),
    onSuccess: (data) => queryClient.setQueryData(['staff', 'alert-settings'], data),
  });

  return (
    <Screen back backTo="/staff/alerts">
      <Text variant="title">Alert settings</Text>
      <Text variant="bodySoft">
        These come to your phone straight away, day or night. Switch off what you don't want.
      </Text>
      {settings.error || change.error ? (
        <Text variant="body" color={colors.wrongInk}>
          {errorMessage(settings.error ?? change.error, 'Could not save. Try again.')}
        </Text>
      ) : null}
      {settings.data?.settings.map((s) => (
        <View key={s.kind} style={styles.row}>
          <View style={styles.grow}>
            <Text variant="label">{s.label}</Text>
            <Text variant="caption">{s.description}</Text>
          </View>
          <Switch
            value={s.enabled}
            onValueChange={(enabled) => change.mutate({ kind: s.kind, enabled })}
            trackColor={{ true: colors.primary, false: colors.borderStrong }}
            accessibilityLabel={s.label}
            testID={`alert-${s.kind}`}
          />
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  grow: { flex: 1, gap: 2 },
});
