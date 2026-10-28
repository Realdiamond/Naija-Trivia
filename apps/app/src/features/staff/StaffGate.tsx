/**
 * The way into staff tools on a phone: sign in once with the staff Google account (30 days on
 * this phone), then the fingerprint or phone PIN each time. On the web, staff use the console.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';
import { errorMessage } from '../../api';
import { staffToolsHere } from '../../platform/staffLock';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/icons';
import { Screen } from '../../ui/Screen';
import { Text } from '../../ui/Text';
import { colors, radius } from '../../ui/theme';
import { loadStaff, staffSignIn, staffUnlock, useStaff } from './session';

export function StaffGate({ children }: { children: ReactNode }) {
  const { loaded, session, unlocked } = useStaff();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void loadStaff();
  }, []);

  // Ask for the fingerprint as soon as the locked tab opens.
  useEffect(() => {
    if (loaded && session && !unlocked) void staffUnlock();
  }, [loaded, session, unlocked]);

  if (!staffToolsHere) return <Redirect href="/home" />;
  if (!loaded) {
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }
  if (session && unlocked) return <>{children}</>;

  const signIn = async () => {
    setBusy(true);
    setNote(null);
    try {
      const outcome = await staffSignIn();
      if (outcome === 'no_lock') {
        setNote('Set a screen lock (fingerprint, PIN or pattern) on this phone first, then try again.');
      }
    } catch (e) {
      setNote(errorMessage(e, 'Could not reach the server. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    setNote(null);
    if (!(await staffUnlock())) setNote('Not unlocked. Try again.');
  };

  return (
    <Screen back backTo="/home">
      <View style={styles.card}>
        <Icon name="shield" size={40} color={colors.primaryInk} />
        <Text variant="title" testID="staff-gate-title">
          {session ? 'Staff tools are locked' : 'Staff tools on this phone'}
        </Text>
        <Text variant="bodySoft">
          {session
            ? 'Use your fingerprint or phone PIN to open them.'
            : 'Sign in with your staff Google account. This phone stays signed in for 30 days, and staff tools ask for your fingerprint or phone PIN each time they open. You can sign the phone out from the console.'}
        </Text>
        {session ? (
          <Button label="Unlock" onPress={() => void unlock()} testID="staff-unlock" />
        ) : (
          <Button
            label="Continue with Google"
            loading={busy}
            onPress={() => void signIn()}
            testID="staff-sign-in"
          />
        )}
        {note ? (
          <Text variant="body" color={colors.wrongInk}>
            {note}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 14,
    padding: 20,
    marginTop: 12,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
