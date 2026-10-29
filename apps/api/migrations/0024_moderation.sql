-- Moderation (build plan step 2.7d, doc 10 §2's enforcement ladder). `moderation_actions` comes
-- from 0001; nothing has written it before.

-- A ban's end (null with status 'banned' is for good), and the shadow restriction: still playing,
-- but left off the boards other players see.
ALTER TABLE users ADD COLUMN banned_until timestamptz;
ALTER TABLE users ADD COLUMN hidden_from_boards boolean NOT NULL DEFAULT false;

ALTER TABLE moderation_actions DROP CONSTRAINT moderation_actions_action_check;
ALTER TABLE moderation_actions ADD CONSTRAINT moderation_actions_action_check
  CHECK (action IN ('warn', 'mute', 'rename', 'ban', 'unban', 'shadow_restrict', 'unrestrict'));
-- What the player is told, and when they saw it; a ban's end; anything else worth keeping
-- (the username taken away).
ALTER TABLE moderation_actions ADD COLUMN message text CHECK (char_length(message) <= 500);
ALTER TABLE moderation_actions ADD COLUMN seen_at timestamptz;
ALTER TABLE moderation_actions ADD COLUMN ends_at timestamptz;
ALTER TABLE moderation_actions ADD COLUMN details jsonb;
CREATE INDEX moderation_actions_user_idx ON moderation_actions (target_user_id, created_at DESC);

-- A moderator's note when they dismiss or act on an integrity flag.
ALTER TABLE integrity_flags ADD COLUMN review_note text CHECK (char_length(review_note) <= 500);
CREATE INDEX integrity_flags_user_idx ON integrity_flags (user_id, created_at DESC);
