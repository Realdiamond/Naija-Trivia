/**
 * "Continue with Google" on Android (TRD §5.6): Google's own account picker through Play
 * services, handing back an ID token the API checks (POST /v1/auth/google). Needs the web client
 * id (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, the token's audience) and an Android OAuth client for the
 * app's signing certificate in the same Google Cloud project. iOS joins with its build (2.8).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { GOOGLE_WEB_CLIENT_ID } from '../config';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { colors } from '../ui/theme';

export const googleAvailable = GOOGLE_WEB_CLIENT_ID !== '';

let configured = false;

/**
 * An ID token for the Google account the person picks, or null if they back out. The picker
 * always shows, so someone with several accounts (a staff one, say) can choose.
 */
export async function googleIdToken(): Promise<string | null> {
  if (!configured) {
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    configured = true;
  }
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  await GoogleSignin.signOut().catch(() => undefined);
  const result = await GoogleSignin.signIn();
  return isSuccessResponse(result) ? result.data.idToken : null;
}

export function GoogleButton({ onToken, label }: { onToken: (idToken: string) => void; label: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const press = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const token = await googleIdToken();
      if (token) onToken(token);
    } catch (e) {
      // A second tap while the picker is open is not a failure.
      if (!(isErrorWithCode(e) && e.code === statusCodes.IN_PROGRESS)) {
        console.warn('Google sign-in failed', e);
        setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Button
        label={label}
        variant="outline"
        loading={busy}
        onPress={() => void press()}
        testID="google-sign-in"
      />
      {failed ? (
        <Text variant="caption" color={colors.wrongInk} align="center">
          {t('signin.googleFailed')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { gap: 6 } });
