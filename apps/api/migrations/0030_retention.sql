-- Retention (doc 08 §4, build plan step 2.7n): each night the retention job removes what is past
-- its time and records what it did, so the console can show that the policy is kept.
CREATE TABLE retention_runs (
  id              bigserial PRIMARY KEY,
  rule            text NOT NULL,                       -- e.g. 'duel_timing', 'daily_results'
  cutoff          timestamptz NOT NULL,                -- older than this was removed
  rows            int NOT NULL,
  ran_at          timestamptz NOT NULL
);
CREATE INDEX retention_runs_rule_idx ON retention_runs (rule, ran_at DESC);

-- Duel answers still holding raw timing, oldest first: the job strips it after 180 days.
CREATE INDEX duel_answers_raw_timing_idx ON duel_answers (served_at)
  WHERE client_elapsed_ms IS NOT NULL OR rtt_est_ms IS NOT NULL OR tab_hidden_ms IS NOT NULL;
CREATE INDEX daily_results_completed_idx ON daily_results (completed_at);
CREATE INDEX party_games_ended_idx ON party_games (ended_at);
