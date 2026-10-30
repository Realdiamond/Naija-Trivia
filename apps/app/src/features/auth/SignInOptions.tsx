/**
 * The sign-in buttons that are switched on (GET /v1/auth/methods). At launch phone codes are off
 * to save SMS costs, so players use Google, an email code (or Apple on iPhone), or stay guests.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { PublicUser } from '@whosabi/shared-types';
import { api, errorMessage } from '../../api';
import { GoogleButton, googleAvailable } from '../../auth/GoogleButton';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Text } from '../../ui/Text';
import { colors } from '../../ui/theme';

export function useAuthMethods() {
  return useQuery({ queryKey: ['auth-methods'], queryFn: () => api.methods(), staleTime: 5 * 60_000 });
}

/** Where a player goes once signed in: pick a username first if they have none. */
export function afterSignIn(user: PublicUser): void {
  router.replace(user.username ? '/home' : '/profile-setup');
}

/**
 * `lead`: the first way in is the one filled button, the others outlines. The sign-in page turns
 * it off while its own "Send code" is the main button.
 */
export function SignInOptions({ showCodes = true, lead = true }: { showCodes?: boolean; lead?: boolean }) {
  const t = useT();
  const methods = useAuthMethods();
  const [error, setError] = useState<string | null>(null);

  const google = async (idToken: string) => {
    setError(null);
    try {
      afterSignIn((await api.signInWithGoogle(idToken)).user);
    } catch (e) {
      setError(errorMessage(e, t('error.network')));
    }
  };

  if (methods.isPending) return null;
  const phoneOn = methods.data?.phone === true;
  const emailOn = methods.data?.email === true;
  const withGoogle = methods.data?.google === true && googleAvailable;
  const shown = [
    showCodes && phoneOn ? 'phone' : null,
    withGoogle ? 'google' : null,
    showCodes && emailOn ? 'email' : null,
  ].filter(Boolean);
  const main = lead ? shown[0] : null;

  return (
    <View style={styles.wrap}>
      {showCodes && phoneOn ? (
        <Button
          label={t('signin.phoneButton')}
          icon="phone"
          variant={main === 'phone' ? 'primary' : 'outline'}
          onPress={() => router.push('/sign-in?with=phone')}
          testID="signin-phone"
        />
      ) : null}
      {withGoogle ? (
        <GoogleButton
          label={t('signin.google')}
          primary={main === 'google'}
          onToken={(token) => void google(token)}
        />
      ) : null}
      {showCodes && emailOn ? (
        <Button
          label={t('signin.emailButton')}
          icon="mail"
          variant={main === 'email' ? 'primary' : 'outline'}
          onPress={() => router.push('/sign-in?with=email')}
          testID="signin-email"
        />
      ) : null}
      {!phoneOn && !emailOn && !withGoogle ? (
        <Text variant="bodySoft" testID="signin-none">
          {t('signin.noMethods')}
        </Text>
      ) : null}
      {error ? (
        <Text variant="body" color={colors.wrongInk} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: 12 } });
