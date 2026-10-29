-- Lifelines in duels (build plan step 2.4b, GDD §5.2): one of each per duel and player, paid for
-- through the ledger. `effect` is what the player was shown: 50/50's two removed options, Ask
-- Naija's percentages (both in canonical order), or the question Skip swapped in.
CREATE TABLE duel_lifelines (
  duel_id         text NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  user_id         text NOT NULL REFERENCES users(id),
  type            text NOT NULL CHECK (type IN ('fifty', 'ask_naija', 'skip', 'time')),
  round_no        smallint NOT NULL CHECK (round_no BETWEEN 1 AND 3),
  seq             smallint NOT NULL,
  question_id     text NOT NULL,                       -- the question it was used on (Skip: the one skipped)
  effect          jsonb NOT NULL DEFAULT '{}',
  paid_with       text NOT NULL CHECK (paid_with IN ('coins', 'ad')),
  created_at      timestamptz NOT NULL,
  PRIMARY KEY (duel_id, user_id, type)
);

-- Extra Time: how much longer this answer may take.
ALTER TABLE duel_answers ADD COLUMN extra_ms int NOT NULL DEFAULT 0;
