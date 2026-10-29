/**
 * Deleting your account (build plan step 2.8a, Google Play's account deletion rule): in the app
 * from Settings, and on the web at /delete-account, where a signed-out visitor is told how. It
 * happens at once and for good, so the player types DELETE to confirm.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { routes, type DeleteAccountResponse } from '@whosabi/shared-types';
import { api, errorMessage } from '../api';
import { signOut, useSession } from '../auth/session';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Screen } from '../ui/Screen';
import { Text } from '../ui/Text';
import { colors, radius } from '../ui/theme';

const CONFIRM_WORD = 'DELETE';

export default function DeleteAccount() {
  const t = useT();
  const status = useSession((s) => s.status);
  const signedIn = status === 'guest' || status === 'account';
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<DeleteAccountResponse>(routes.meDelete(), { confirm: true });
      await signOut();
      router.replace('/welcome');
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
      setBusy(false);
    }
  };

  return (
    <Screen back backTo={signedIn ? '/settings' : '/welcome'} contentStyle={styles.content}>
      <Text variant="title" accessibilityRole="header">
        {t('deleteAccount.title')}
      </Text>
      <Text variant="body">{t('deleteAccount.what')}</Text>
      <View style={styles.box}>
        <Text variant="label">{t('deleteAccount.goes')}</Text>
        <Text variant="body">{t('deleteAccount.goesList')}</Text>
        <Text variant="label" style={styles.kept}>
          {t('deleteAccount.stays')}
        </Text>
        <Text variant="body">{t('deleteAccount.staysList')}</Text>
      </View>

      {signedIn ? (
        <>
          <Field
            label={t('deleteAccount.typeToConfirm', { word: CONFIRM_WORD })}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            testID="delete-confirm-word"
          />
          {error ? (
            <Text variant="body" color={colors.wrongInk} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button
            label={t('deleteAccount.button')}
            variant="dark"
            loading={busy}
            disabled={typed.trim().toUpperCase() !== CONFIRM_WORD}
            onPress={() => void remove()}
            testID="delete-account"
          />
        </>
      ) : (
        <>
          <Text variant="body">{t('deleteAccount.signInFirst')}</Text>
          <Button
            label={t('deleteAccount.signIn')}
            onPress={() => router.push('/sign-in')}
            testID="delete-sign-in"
          />
          <Text variant="caption">{t('deleteAccount.byEmail')}</Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 24 },
  box: { gap: 6, padding: 16, borderRadius: radius.card, backgroundColor: colors.surface },
  kept: { marginTop: 8 },
});
