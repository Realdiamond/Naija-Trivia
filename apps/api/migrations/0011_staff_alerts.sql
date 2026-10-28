-- Staff alerts (build plan step 2.9b, owner's decisions of 28 Oct 2026): pushed to staff phones at
-- once, day or night, and listed in the Staff tab. All kinds are on until someone switches one off.

CREATE TABLE staff_alerts (
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('problem', 'signup', 'payment_opened', 'payment_started', 'payment_paid')),
  title           text NOT NULL,
  body            text NOT NULL,
  url             text,                                -- where tapping it goes in the Staff tab
  dedupe_key      text UNIQUE,                         -- one alert per key, e.g. 'daily_missing:2026-11-03'
  created_at      timestamptz NOT NULL,
  attempts        int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  delivered_at    timestamptz                          -- pushed (or nobody to push to)
);
CREATE INDEX staff_alerts_waiting_idx ON staff_alerts (id) WHERE delivered_at IS NULL;
CREATE INDEX staff_alerts_created_idx ON staff_alerts (created_at DESC);

-- A kind someone switched off (or back on). No row means on.
CREATE TABLE admin_alert_prefs (
  admin_id        text NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  enabled         boolean NOT NULL,
  PRIMARY KEY (admin_id, kind)
);

-- The newest alert each staff member has seen, for the unread count.
ALTER TABLE admin_users ADD COLUMN alerts_seen_id bigint NOT NULL DEFAULT 0;
-- The phone's push token, for staff alerts on that phone.
ALTER TABLE admin_phone_sessions ADD COLUMN push_token text;
