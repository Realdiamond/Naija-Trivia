/**
 * Settings (UX §1): language, notifications, Data Saver (build plan step 2.8b), family mode,
 * being findable from contacts, a copy of your data and deleting your account (step 2.8a), and
 * signing out.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { routes, type Me, type UpdateMeRequest } from '@whosabi/shared-types';
import { api, errorMessage } from '../api';
import { trackEvent } from '../analytics';
import { signOut, useSession } from '../auth/session';
import { dataSaverOn } from '../features/dataSaver/rules';
import { chooseDataSaver, useDataSaver } from '../features/dataSaver/store';
import { useLanguage, useT, type MessageKey } from '../i18n';
import { saveFromApi } from '../platform/saveData';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, radius } from '../ui/theme';

export default function Settings() {
  const t = useT();
  const status = useSession((s) => s.status);
  const signedIn = status === 'guest' || status === 'account';
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>(routes.me()), enabled: signedIn });
  const language = useLanguage((s) => s.language);
  const setLanguage = useLanguage((s) => s.setLanguage);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dataSaver = useDataSaver();

  const save = useMutation({
    mutationFn: (changes: UpdateMeRequest) => api.request<Me>('PATCH', routes.me(), { body: changes }),
    onMutate: (changes) => queryClient.setQueryData<Me>(['me'], (old) => old && { ...old, ...changes }),
    onSuccess: (data) => queryClient.setQueryData(['me'], data),
    onError: () => void queryClient.invalidateQueries({ queryKey: ['me'] }),
  });

  if (status === 'signed_out') return <Redirect href="/welcome" />;

  const pickLanguage = (next: 'en' | 'pcm') => {
    setLanguage(next);
    save.mutate({ language: next });
  };

  // Kept on the device straight away, and in the profile for the player's other phones.
  const pickDataSaver = (choice: boolean | null) => {
    chooseDataSaver(choice);
    save.mutate({ data_saver: choice });
    if (choice !== null) trackEvent('data_saver_toggled', { on: choice });
  };

  const download = async () => {
    setSaving(true);
    setNote(null);
    try {
      await saveFromApi(routes.meExport(), `whosabi-data-${new Date().toISOString().slice(0, 10)}.json`);
      setNote(t('settings.downloaded'));
    } catch (e) {
      setNote(errorMessage(e, t('error.network')));
    } finally {
      setSaving(false);
    }
  };

  const restricted = me.data?.status === 'restricted';
  return (
    <Screen back backTo="/home" contentStyle={styles.content}>
      <Text variant="title" accessibilityRole="header">
        {t('settings.title')}
      </Text>

      <Text variant="heading" style={styles.section}>
        {t('settings.language')}
      </Text>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {(['en', 'pcm'] as const).map((l) => (
          <Pressable
            key={l}
            accessibilityRole="radio"
            accessibilityState={{ checked: language === l }}
            onPress={() => pickLanguage(l)}
            style={[styles.choice, language === l && styles.chosen]}
            testID={`language-${l}`}
          >
            <Text variant="label">{l === 'en' ? 'English' : 'Pidgin'}</Text>
          </Pressable>
        ))}
      </View>

      <Row
        icon="bell"
        label="settings.notifications"
        onPress={() => router.push('/notifications')}
        testID="open-notify"
      />

      <Toggle
        label="settings.dataSaver"
        hint={
          dataSaver.choice !== null
            ? 'settings.dataSaverHint'
            : dataSaver.slow
              ? 'settings.dataSaverAutoOn'
              : 'settings.dataSaverAutoOff'
        }
        value={dataSaverOn(dataSaver)}
        disabled={false}
        onChange={pickDataSaver}
        testID="data-saver"
      />
      {dataSaver.choice !== null ? (
        <Button
          label={t('settings.dataSaverAuto')}
          variant="link"
          size="medium"
          onPress={() => pickDataSaver(null)}
          testID="data-saver-auto"
        />
      ) : null}

      {me.data && status === 'account' ? (
        <>
          <Toggle
            label="settings.familyMode"
            hint={restricted ? 'settings.familyModeLocked' : 'settings.familyModeHint'}
            value={me.data.family_mode}
            disabled={restricted}
            onChange={(family_mode) => save.mutate({ family_mode })}
            testID="family-mode"
          />
          <Toggle
            label="settings.discoverable"
            hint="settings.discoverableHint"
            value={me.data.discoverable}
            disabled={restricted}
            onChange={(discoverable) => save.mutate({ discoverable })}
            testID="discoverable"
          />
        </>
      ) : null}

      <Row icon="arrow-right" label="settings.help" onPress={() => router.push('/help')} testID="open-help" />

      <Text variant="heading" style={styles.section}>
        {t('settings.yourData')}
      </Text>
      <Row
        icon="arrow-right"
        label="settings.download"
        onPress={() => void download()}
        busy={saving}
        testID="download-data"
      />
      {note ? (
        <Text variant="body" accessibilityLiveRegion="polite" testID="download-note">
          {note}
        </Text>
      ) : null}
      <Row
        icon="cross"
        label="settings.delete"
        danger
        onPress={() => router.push('/delete-account')}
        testID="open-delete"
      />

      {status === 'account' ? (
        <Button
          label={t('home.signOut')}
          variant="link"
          size="medium"
          icon="logout"
          onPress={() => void signOut().then(() => router.replace('/welcome'))}
        />
      ) : null}
    </Screen>
  );
}

function Row({
  icon,
  label,
  onPress,
  danger = false,
  busy = false,
  testID,
}: {
  icon: IconName;
  label: MessageKey;
  onPress: () => void;
  danger?: boolean;
  busy?: boolean;
  testID: string;
}) {
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={testID}
    >
      <Text variant="body" color={danger ? colors.wrongInk : colors.ink} style={styles.grow}>
        {t(label)}
      </Text>
      <Icon name={busy ? 'clock' : icon} size={20} color={danger ? colors.wrongInk : colors.inkSoft} />
    </Pressable>
  );
}

function Toggle({
  label,
  hint,
  value,
  disabled,
  onChange,
  testID,
}: {
  label: MessageKey;
  hint: MessageKey;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  testID: string;
}) {
  const t = useT();
  return (
    <View style={styles.row}>
      <View style={styles.grow}>
        <Text variant="body">{t(label)}</Text>
        <Text variant="caption">{t(hint)}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        accessibilityLabel={t(label)}
        trackColor={{ true: colors.primary, false: colors.border }}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: 8, paddingBottom: 24 },
  section: { marginTop: 16 },
  choices: { flexDirection: 'row', gap: 10 },
  choice: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chosen: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
});
