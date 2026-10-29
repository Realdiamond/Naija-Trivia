-- Packs and Solo Practice (GDD §2.6, §6.1, build plan step 2.8f). Nothing has written `packs`
-- before. A pack with a category also holds every live question in that category: the six core
-- packs are made that way, one for each category, free.
ALTER TABLE packs
  ADD COLUMN category_id text REFERENCES categories(id),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT packs_price_check CHECK ((access = 'coins') = (price_coins IS NOT NULL AND price_coins > 0)),
  ADD CONSTRAINT packs_window_check CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);
CREATE INDEX pack_questions_question_idx ON pack_questions (question_id);

INSERT INTO packs (id, slug, title, access, category_id)
SELECT 'pk_core_' || id, id, name_en, 'free', id FROM categories;

-- Coins packs a player has unlocked, for good.
CREATE TABLE pack_unlocks (
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_id         text NOT NULL REFERENCES packs(id),
  coins           int NOT NULL,
  unlocked_at     timestamptz NOT NULL,
  PRIMARY KEY (user_id, pack_id)
);

-- A player's practice set for a pack: the same questions all week (ISO week, WAT), so fetching it
-- again shows nothing new. Results are checked against it.
CREATE TABLE practice_sets (
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pack_id         text NOT NULL REFERENCES packs(id),
  week            text NOT NULL,
  question_ids    text[] NOT NULL,
  issued_at       timestamptz NOT NULL,
  PRIMARY KEY (user_id, pack_id, week)
);
CREATE INDEX practice_sets_issued_idx ON practice_sets (issued_at);

-- Finished practice games, each paid once (the id is made on the device).
CREATE TABLE practice_results (
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id              uuid NOT NULL,
  pack_id         text NOT NULL REFERENCES packs(id),
  week            text NOT NULL,
  answered        smallint NOT NULL,
  correct         smallint NOT NULL,
  complete        boolean NOT NULL,
  xp              int NOT NULL,
  played_at       timestamptz NOT NULL,
  received_at     timestamptz NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX practice_results_received_idx ON practice_results (user_id, received_at);
