-- Account deletion and data requests (build plan step 2.8a, NDPA 2023, doc 08 §4). The table
-- comes from 0001; nothing has written it before.
ALTER TABLE dsar_requests ADD COLUMN source text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'console'));
-- The staff member who logged a request for the player, and who completed it ('player' when they
-- did it themselves in the app).
ALTER TABLE dsar_requests ADD COLUMN started_by text;
ALTER TABLE dsar_requests ADD COLUMN handled_by text;
ALTER TABLE dsar_requests ADD COLUMN note text CHECK (char_length(note) <= 500);
CREATE INDEX dsar_requests_open_idx ON dsar_requests (due_at) WHERE status IN ('received', 'in_progress');
CREATE INDEX dsar_requests_user_idx ON dsar_requests (user_id, created_at DESC);
