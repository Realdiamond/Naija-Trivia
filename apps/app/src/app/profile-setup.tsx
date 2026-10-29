/**
 * Username, avatar, age and home state (mockup 06), once a player has an account. The username
 * is picked once (doc 16); the age band decides a restricted account for 13–17s (doc 10 §3.3).
 */
import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorCode, routes, Username, type HomeState, type Me } from '@whosabi/shared-types';
import { api, ApiError, errorMessage } from '../api';
import { updateUser, useSession } from '../auth/session';
import { useNoticeSeen } from '../features/moderation/notices';
import { STATE_NAMES, STATES_BY_NAME } from '../features/profile/states';
import { useT } from '../i18n';
import { Avatar, AVATARS } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/icons';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, CONTENT_MAX_WIDTH, radius } from '../ui/theme';

type AgeChoice = 'under_13' | '13_17' | '18_plus';

/** Errors about the name itself, shown under the username field. */
const USERNAME_ERRORS: ReadonlySet<string> = new Set([
  ErrorCode.usernameTaken,
  ErrorCode.usernameNotAllowed,
  ErrorCode.usernameLocked,
]);

export default function ProfileSetup() {
  const t = useT();
  const status = useSession((s) => s.status);
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>(routes.me()),
    enabled: status === 'account',
  });
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState<string>(AVATARS[1].id);
  const [age, setAge] = useState<AgeChoice | null>(null);
  const [homeState, setHomeState] = useState<HomeState | null>(null);
  const [picking, setPicking] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noticeSeen = useNoticeSeen();

  if (status === 'signed_out') return <Redirect href="/welcome" />;
  if (status === 'guest') return <Redirect href="/sign-in" />;

  const ageSet = me.data?.age_band != null;
  // Back here because a moderator took the username away (step 2.7d).
  const renamed = me.data?.notices.find((n) => n.kind === 'renamed');
  const checked = Username.safeParse(username);
  const avatarName = AVATARS.find((a) => a.id === avatar)?.name ?? '';

  const save = async () => {
    setError(null);
    setUsernameError(null);
    if (!checked.success) {
      setUsernameError(checked.error.issues[0]?.message ?? null);
      return;
    }
    if (!ageSet && !age) {
      setError(t('profile.pickAge'));
      return;
    }
    if (age === 'under_13') {
      setError(t('profile.under13Blocked'));
      return;
    }
    setBusy(true);
    try {
      let updated = await api.patch<Me>(routes.me(), {
        username: checked.data,
        avatar_id: avatar,
        ...(homeState ? { home_state: homeState } : {}),
      });
      if (!updated.age_band && age) updated = await api.post<Me>(routes.meAge(), { age_band: age });
      queryClient.setQueryData(['me'], updated);
      updateUser({ username: updated.username, status: updated.status });
      if (renamed) noticeSeen(renamed.id);
      router.replace('/home');
    } catch (e) {
      if (e instanceof ApiError && USERNAME_ERRORS.has(e.code)) {
        setUsernameError(e.detail ? `${e.message}. ${e.detail}` : e.message);
      } else {
        setError(errorMessage(e, t('error.network')));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <>
          {error ? (
            <Text variant="body" color={colors.wrongInk} align="center" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button
            label={t('profile.continue')}
            loading={busy}
            onPress={() => void save()}
            testID="profile-continue"
          />
        </>
      }
    >
      <View style={styles.form}>
        <Text variant="display" accessibilityRole="header">
          {t('profile.title')}
        </Text>
        {renamed ? (
          <Text variant="body" color={colors.accentInk} testID="renamed-notice">
            {t('notice.renamed')}
          </Text>
        ) : null}

        <Field
          label={t('profile.username')}
          value={username}
          onChangeText={(text) => {
            setUsername(text.trim());
            setUsernameError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          maxLength={20}
          hint={t('profile.usernameHint')}
          hintColor={checked.success ? colors.correctInk : undefined}
          error={usernameError}
          trailing={checked.success ? <Icon name="check" color={colors.correctInk} strokeWidth={3} /> : null}
          testID="username"
        />

        <View style={styles.group}>
          <Text variant="label">{t('profile.avatar')}</Text>
          <View style={styles.avatars} accessibilityRole="radiogroup">
            {AVATARS.map((a) => (
              <Pressable
                key={a.id}
                accessibilityRole="radio"
                accessibilityLabel={a.name}
                accessibilityState={{ selected: avatar === a.id }}
                onPress={() => setAvatar(a.id)}
                style={[styles.avatar, avatar === a.id && styles.avatarChosen]}
              >
                <Avatar id={a.id} size={44} />
              </Pressable>
            ))}
          </View>
          <Text variant="caption">{t('profile.avatarNote', { name: avatarName })}</Text>
        </View>

        {!ageSet ? (
          <View style={styles.group}>
            <Text variant="label">{t('profile.age')}</Text>
            <View style={styles.ages} accessibilityRole="radiogroup">
              {(
                [
                  ['under_13', t('profile.under13')],
                  ['13_17', t('profile.13to17')],
                  ['18_plus', t('profile.18plus')],
                ] as Array<[AgeChoice, string]>
              ).map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: age === value }}
                  onPress={() => {
                    setAge(value);
                    setError(null);
                  }}
                  style={[styles.age, age === value && styles.ageChosen]}
                  testID={`age-${value}`}
                >
                  <Text variant="label" align="center">
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.group}>
          <Text variant="label">
            {t('profile.state')} <Text variant="bodySoft">{t('profile.stateNote')}</Text>
          </Text>
          <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={styles.select}>
            <Text variant="body" color={homeState ? colors.ink : colors.muted}>
              {homeState ? STATE_NAMES[homeState] : t('profile.stateNone')}
            </Text>
            <View style={styles.chevron}>
              <Icon name="back" size={18} />
            </View>
          </Pressable>
        </View>
      </View>

      <Modal visible={picking} animationType="slide" transparent onRequestClose={() => setPicking(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPicking(false)} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <FlatList
            data={STATES_BY_NAME}
            keyExtractor={([code]) => code}
            renderItem={({ item: [code, name] }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setHomeState(code);
                  setPicking(false);
                }}
                style={[styles.option, homeState === code && styles.optionChosen]}
              >
                <Text variant="body">{name}</Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 24 },
  group: { gap: 10 },
  avatars: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  avatar: { padding: 3, borderRadius: 30, borderWidth: 3, borderColor: 'transparent' },
  avatarChosen: { borderColor: colors.accent },
  ages: { flexDirection: 'row', gap: 10 },
  age: {
    flex: 1,
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderRadius: radius.button + 4,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  ageChosen: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
    borderRadius: radius.button + 4,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chevron: { transform: [{ rotate: '-90deg' }] },
  backdrop: { flex: 1, backgroundColor: 'rgba(14, 26, 20, 0.4)' },
  sheet: {
    maxHeight: '60%',
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingVertical: 8,
  },
  option: { paddingHorizontal: 20, paddingVertical: 14 },
  optionChosen: { backgroundColor: colors.primaryTint },
});
