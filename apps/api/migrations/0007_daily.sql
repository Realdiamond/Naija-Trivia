-- The Daily Sabi Challenge and leaderboards (build plan step 2.1, TRD §4.5, §5.5).

-- When a Daily was picked, and when its final ranks were saved (the nightly snapshot).
ALTER TABLE daily_challenges ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE daily_challenges ADD COLUMN snapshot_at timestamptz;

-- What the result screen shows again later: XP earned and the streak after this Daily; the
-- final ranks come from the nightly snapshot (null until then).
ALTER TABLE daily_results ADD COLUMN xp int NOT NULL DEFAULT 0;
ALTER TABLE daily_results ADD COLUMN streak int NOT NULL DEFAULT 0;
ALTER TABLE daily_results ADD COLUMN used_freeze boolean NOT NULL DEFAULT false;
ALTER TABLE daily_results ADD COLUMN rank int;
ALTER TABLE daily_results ADD COLUMN state_rank int;
ALTER TABLE daily_results ADD CONSTRAINT daily_results_grid_check CHECK (grid ~ '^[GR]{7}$');

-- The day's board in order (rebuilding Redis, friends boards, the snapshot) and a player's history.
CREATE INDEX daily_results_board_idx ON daily_results (daily_id, score DESC, total_ms);
CREATE INDEX daily_results_user_idx ON daily_results (user_id, daily_id DESC);

-- The week's board at its end: Daily points from Monday to Sunday WAT (ISO week, e.g. '2026-W45').
CREATE TABLE weekly_standings (
  iso_week        text NOT NULL,
  user_id         text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score           int NOT NULL,
  dailies         smallint NOT NULL,
  home_state      char(2),
  rank            int NOT NULL,
  state_rank      int,
  PRIMARY KEY (iso_week, user_id)
);
