'use client';
/** "Sign in with Google" for staff (Google Identity Services); the ID token goes to the API. */
import { useEffect, useRef, useState } from 'react';
import { signInWithGoogle } from './actions';

interface GoogleId {
  initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
  renderButton(element: HTMLElement, options: { theme: 'filled_black'; size: 'large'; width: number }): void;
}

export function GoogleSignIn({ clientId }: { clientId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      const id = (window as unknown as { google: { accounts: { id: GoogleId } } }).google.accounts.id;
      id.initialize({
        client_id: clientId,
        callback: ({ credential }) => {
          void signInWithGoogle(credential).then((state) => setError(state.error));
        },
      });
      if (host.current) id.renderButton(host.current, { theme: 'filled_black', size: 'large', width: 360 });
    };
    script.onerror = () => setError('Google sign-in could not load. Check your connection.');
    document.head.appendChild(script);
    return () => script.remove();
  }, [clientId]);

  return (
    <>
      <div ref={host} />
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}
