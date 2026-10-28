-- Web push (build plan step 2.5c, TRD FR-NOT-4). A browser's subscription is its endpoint, kept
-- as the device's push token, and the keys its pushes are encrypted with.
ALTER TABLE devices ADD COLUMN web_keys jsonb;          -- {p256dh, auth}; web only

-- Kinds of push a player switched off in the app ('duels', 'friends', 'daily'): browsers have no
-- notification channels like Android's, so the app has its own switches.
ALTER TABLE users ADD COLUMN push_off text[] NOT NULL DEFAULT '{}';

-- 'muted': the player switched that kind off.
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_outcome_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_outcome_check
  CHECK (outcome IN ('sent', 'logged', 'no_device', 'capped', 'expired', 'failed', 'muted'));
