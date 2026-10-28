-- Staff on the phone (build plan step 2.9a, owner's decisions of 28 Oct 2026).

-- The player account a staff member uses in the app: linked when they sign in to the app with
-- Google using the email on the staff list, so the app knows to show them the Staff tab.
ALTER TABLE admin_users ADD COLUMN player_id text REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX admin_users_player_key ON admin_users (player_id) WHERE player_id IS NOT NULL;

-- A staff session on one phone: 30 days, opened with the phone's fingerprint or PIN, listed in
-- the console and signed out from there. Only the token's hash is kept.
CREATE TABLE admin_phone_sessions (
  id              text PRIMARY KEY,
  admin_id        text NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  label           text NOT NULL,                       -- the phone, e.g. 'samsung SM-A145F'
  created_at      timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  last_used_at    timestamptz NOT NULL,
  revoked_at      timestamptz,
  revoked_by      text
);
CREATE INDEX admin_phone_sessions_admin_idx ON admin_phone_sessions (admin_id, created_at DESC);
