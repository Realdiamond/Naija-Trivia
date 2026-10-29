-- Support (doc 16 §3, doc 18 §13, build plan step 2.7p): messages players send from the app's
-- Help screen. Each is kept here for User 360 and the console's queue, and emailed to the
-- helpdesk's inbox (SUPPORT_INBOX) when one is set.
CREATE TABLE support_tickets (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic           text NOT NULL CHECK (topic IN ('purchase', 'streak', 'question', 'account', 'sign_in', 'ban', 'other')),
  message         text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  email           text,                                -- where the player wants the answer, if not in the app
  platform        text NOT NULL,
  app_version     text,
  device          text,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered')),
  answer          text CHECK (char_length(answer) <= 2000), -- shown in the app's Help screen
  emailed_at      timestamptz,                         -- sent to the helpdesk's inbox
  answered_by     text REFERENCES admin_users(id),
  answered_at     timestamptz,
  created_at      timestamptz NOT NULL
);
CREATE INDEX support_tickets_user_idx ON support_tickets (user_id, created_at DESC);
CREATE INDEX support_tickets_open_idx ON support_tickets (created_at) WHERE status = 'open';
