/**
 * "Continue with Google" on the web, drawn by Google Identity Services. It hands back an ID
 * token, which the API checks (POST /v1/auth/google). Needs EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.
 */
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { GOOGLE_WEB_CLIENT_ID } from '../config';
import { loadScript } from '../platform/loadScript';
import { Button } from '../ui/Button';

interface GoogleId {
  initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
  renderButton(
    element: HTMLElement,
    options: { theme: 'outline'; size: 'large'; text: 'continue_with'; shape: 'rectangular'; width: number },
  ): void;
}

export const googleAvailable = GOOGLE_WEB_CLIENT_ID !== '';

/** The phone's account picker; the web signs in through the button below instead. */
export async function googleIdToken(): Promise<string | null> {
  throw new Error('Google sign-in by picker is for the phone app');
}

export function GoogleButton({ onToken, label }: { onToken: (idToken: string) => void; label: string }) {
  const host = useRef<ComponentRef<typeof View>>(null);
  const callback = useRef(onToken);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    callback.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!googleAvailable) return;
    let cancelled = false;
    loadScript('https://accounts.google.com/gsi/client')
      .then(() => {
        const element = host.current as unknown as HTMLElement | null;
        if (cancelled || !element) return;
        const id = (window as unknown as { google: { accounts: { id: GoogleId } } }).google.accounts.id;
        id.initialize({ client_id: GOOGLE_WEB_CLIENT_ID, callback: (r) => callback.current(r.credential) });
        id.renderButton(element, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: Math.min(400, element.clientWidth || 400),
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!googleAvailable) return null;
  if (failed) return <Button label={label} variant="outline" disabled />;
  return <View ref={host} style={styles.host} />;
}

const styles = StyleSheet.create({ host: { minHeight: 44, alignItems: 'center' } });
