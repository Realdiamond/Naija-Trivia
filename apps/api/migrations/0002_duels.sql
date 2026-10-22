-- Duels (build plan step 1.1): what the duel API needs beyond the v1.1 schema.

-- Closest-number questions (duel tie-breaks) have no options: the answer is numeric_answer.
ALTER TABLE questions ALTER COLUMN correct_index DROP NOT NULL;
ALTER TABLE questions DROP CONSTRAINT questions_check;
ALTER TABLE questions ADD CONSTRAINT questions_answer_check CHECK (
  CASE WHEN type = 'closest_number'
    THEN numeric_answer IS NOT NULL AND correct_index IS NULL AND jsonb_array_length(options) = 0
    ELSE correct_index IS NOT NULL AND correct_index >= 0 AND correct_index < jsonb_array_length(options)
  END
);

-- Nobody duels themselves.
ALTER TABLE duels ADD CONSTRAINT duels_players_check CHECK (player_b IS NULL OR player_b <> player_a);

-- One rematch per finished duel, so two quick taps (or both players at once) start one duel.
ALTER TABLE duels ADD COLUMN rematch_of text UNIQUE REFERENCES duels(id);

-- Tie-breaks have a deadline too, so the expiry sweep must find them.
DROP INDEX duels_deadline_idx;
CREATE INDEX duels_deadline_idx ON duels (turn_deadline)
  WHERE state IN ('created','wait_b_r1r2','wait_a_r2r3','wait_b_r3','tiebreak');

-- The tie-break guess, and the Idempotency-Key of the request that answered (a retry with a
-- different key is refused, doc 14 §4.2).
ALTER TABLE duel_answers ADD COLUMN guess numeric;
ALTER TABLE duel_answers ADD COLUMN idempotency_key text;
ALTER TABLE duel_answers ADD CONSTRAINT duel_answers_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE duel_answers ADD CONSTRAINT duel_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES questions(id);
