-- Background jobs (build plan step 1.3).

-- One row per turn reminder: each turn gets its 24 h and 4 h reminder once, however many
-- workers run. A new turn has a new deadline, so it gets reminders of its own.
CREATE TABLE duel_reminders (
  duel_id         text NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  turn_deadline   timestamptz NOT NULL,
  stage           text NOT NULL CHECK (stage IN ('24h','4h')),
  user_id         text NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (duel_id, turn_deadline, stage)
);

-- Analytics events loaded from the Redis stream (doc 18 §15). They live in Postgres until
-- volume calls for ClickHouse (docs/schema/analytics.clickhouse.sql has the same columns).
-- Raw rows are kept for ANALYTICS_RETENTION_DAYS; analytics_daily keeps the daily counts.
CREATE TABLE analytics_events (
  event_id        text PRIMARY KEY,
  event           text NOT NULL,
  source          text NOT NULL CHECK (source IN ('client','server')),
  ts              timestamptz NOT NULL,
  user_pid        text NOT NULL DEFAULT '',
  anon_id         text NOT NULL DEFAULT '',
  session_id      text NOT NULL DEFAULT '',
  seq             int NOT NULL DEFAULT 0,
  platform        text NOT NULL DEFAULT '',
  app_version     text NOT NULL DEFAULT '',
  os_version      text NOT NULL DEFAULT '',
  device_model    text NOT NULL DEFAULT '',
  browser         text NOT NULL DEFAULT '',
  ram_mb          int NOT NULL DEFAULT 0,
  network_type    text NOT NULL DEFAULT '',
  carrier         text NOT NULL DEFAULT '',
  geo_state       text NOT NULL DEFAULT '',
  home_state      text NOT NULL DEFAULT '',
  language        text NOT NULL DEFAULT '',
  age_band        text NOT NULL DEFAULT '',
  data_saver      boolean NOT NULL DEFAULT false,
  screen          text NOT NULL DEFAULT '',
  props           jsonb NOT NULL DEFAULT '{}',
  loaded_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_ts_idx ON analytics_events (ts);
-- A player's timeline (User 360, doc 18 §7.2).
CREATE INDEX analytics_events_user_idx ON analytics_events (user_pid, ts) WHERE user_pid <> '';
CREATE INDEX analytics_events_event_idx ON analytics_events (event, ts);

-- Events and distinct players per WAT day, platform and event, kept after the raw rows go.
CREATE TABLE analytics_daily (
  day             date NOT NULL,
  platform        text NOT NULL,
  event           text NOT NULL,
  events          bigint NOT NULL,
  players         bigint NOT NULL,
  PRIMARY KEY (day, platform, event)
);
