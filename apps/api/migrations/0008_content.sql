-- The Content module (build plan step 2.6a, doc 04 §3, doc 18 §12).

-- Every step of a question's life: created, imported, edited (with the content before the edit),
-- submitted, approved, sent back with a note, published, suspended (by staff or by reports),
-- restored, retired or expired. `actor` is admin_users.id, or 'system'.
CREATE TABLE question_history (
  id              bigserial PRIMARY KEY,
  question_id     text NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  action          text NOT NULL,
  actor           text NOT NULL,
  note            text,
  version         int NOT NULL,
  snapshot        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX question_history_question_idx ON question_history (question_id, id DESC);

-- The console's question list (newest change first, by status) and the open reports queue.
CREATE INDEX questions_console_idx ON questions (status, updated_at DESC, id);
CREATE INDEX question_reports_open_idx ON question_reports (question_id) WHERE resolution IS NULL;
