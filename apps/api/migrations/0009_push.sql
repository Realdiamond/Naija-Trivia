-- Push notifications (build plan step 2.5b, TRD §4.8, FR-NOT-1 to FR-NOT-3).

-- A push token belongs to one device, and the device to whoever signed in on it last.
CREATE UNIQUE INDEX devices_push_token_key ON devices (push_token) WHERE push_token IS NOT NULL;
CREATE INDEX devices_user_idx ON devices (user_id) WHERE push_token IS NOT NULL;
ALTER TABLE devices ADD COLUMN token_updated_at timestamptz;

-- Every push, queued in the same transaction as the move that causes it and sent by the worker.
-- Quiet hours (22:00–07:00 WAT) move `not_before` to 07:00; a message still unsent at
-- `expires_at` is dropped (a turn that already ran out needs no "your turn"). While a message
-- waits, a newer one with the same `collapse_key` replaces it. `outcome` says what happened.
CREATE TABLE push_outbox (
  id              bigserial PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            text NOT NULL,
  params          jsonb NOT NULL DEFAULT '{}',
  collapse_key    text,
  not_before      timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL,
  attempts        int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  sent_at         timestamptz,
  outcome         text CHECK (outcome IN ('sent', 'logged', 'no_device', 'capped', 'expired', 'failed')),
  CHECK ((sent_at IS NULL) = (outcome IS NULL))
);
CREATE UNIQUE INDEX push_outbox_waiting_key ON push_outbox (user_id, collapse_key)
  WHERE sent_at IS NULL AND collapse_key IS NOT NULL;
CREATE INDEX push_outbox_due_idx ON push_outbox (not_before) WHERE sent_at IS NULL;
-- The daily cap counts what each player was sent today.
CREATE INDEX push_outbox_sent_idx ON push_outbox (user_id, sent_at) WHERE outcome = 'sent';
