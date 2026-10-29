-- Home banners and events (build plan step 2.7h, doc 18 §11, doc 16 §2): staff schedule them in
-- the console; each shows on Home while it runs, and Weekend Wahala ('double_xp') pays double XP
-- for duel answers in one category (or all of them, with no category).
CREATE TABLE live_events (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('banner', 'double_xp')),
  title_en    text NOT NULL CHECK (char_length(title_en) BETWEEN 3 AND 60),
  title_pcm   text CHECK (char_length(title_pcm) BETWEEN 3 AND 60),
  body_en     text CHECK (char_length(body_en) BETWEEN 3 AND 160),
  body_pcm    text CHECK (char_length(body_pcm) BETWEEN 3 AND 160),
  action      text CHECK (action IN ('daily', 'random', 'party', 'challenge', 'leaderboards', 'shop', 'friends')),
  category_id text REFERENCES categories(id),
  -- null: every platform.
  platforms   text[],
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  -- Ended early by staff.
  ended_at    timestamptz,
  created_by  text NOT NULL REFERENCES admin_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (kind = 'double_xp' OR category_id IS NULL)
);
CREATE INDEX live_events_upcoming_idx ON live_events (ends_at) WHERE ended_at IS NULL;
