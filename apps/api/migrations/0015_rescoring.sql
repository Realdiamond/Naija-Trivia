-- Re-scoring corrected answers (build plan step 2.6b-2, TRD FR-CON-7).

-- Each Daily answer is kept with the result, in order: [{qid, picked, ms, correct, points}].
-- The round's own copy in Redis lasts two days; re-scoring looks back 14.
ALTER TABLE daily_results ADD COLUMN answers jsonb;

-- A played question whose answer an editor changed (the options staying the same). The worker
-- re-scores the games of the last 14 days that used it, once: those who picked the new answer
-- get its points and nobody loses any.
CREATE TABLE question_corrections (
  id              bigserial PRIMARY KEY,
  question_id     text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  version         int NOT NULL,
  old_index       smallint NOT NULL,
  new_index       smallint NOT NULL,
  corrected_by    text NOT NULL,
  created_at      timestamptz NOT NULL,
  done_at         timestamptz,
  result          jsonb                                -- what changed, for the console and support
);
CREATE INDEX question_corrections_waiting_idx ON question_corrections (id) WHERE done_at IS NULL;
