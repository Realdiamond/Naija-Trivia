import { DevSignIn } from './DevSignIn';
import { GoogleSignIn } from './GoogleSignIn';

// Settings are read when the page is asked for, not when the app is built.
export const dynamic = 'force-dynamic';

export default async function Login({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  const clientId = process.env.ADMIN_GOOGLE_CLIENT_ID ?? '';
  const dev = process.env.ADMIN_DEV_SIGN_IN === 'true';
  return (
    <main className="login">
      <h1>
        Who Sabi? <span style={{ color: 'var(--accent)' }}>Admin</span>
      </h1>
      <p className="muted">Staff only. Sign in with the Google account on the staff list.</p>
      {expired ? <p className="ok">Your session ended. Sign in again.</p> : null}
      {clientId ? <GoogleSignIn clientId={clientId} /> : null}
      {!clientId && !dev ? (
        <p className="error">Google sign-in is not set up: set ADMIN_GOOGLE_CLIENT_ID on the console.</p>
      ) : null}
      {dev ? <DevSignIn /> : null}
    </main>
  );
}
