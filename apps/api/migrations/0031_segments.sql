-- Segments (build plan step 2.7o, doc 18 §9): saved groups of players, their size each day, and
-- exports of their pseudonymous ids that a second staff member approves. Nothing has written
-- `segments` before.

-- Each segment's size once a day, for its trend.
CREATE TABLE segment_counts (
  segment_id      text NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  day             date NOT NULL,                       -- WAT
  players         int NOT NULL,
  PRIMARY KEY (segment_id, day)
);

-- An export asked for with a reason, approved by someone else (four eyes), downloadable for a day.
CREATE TABLE segment_exports (
  id              text PRIMARY KEY,
  segment_id      text NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  reason          text NOT NULL,
  requested_by    text NOT NULL REFERENCES admin_users(id),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by      text REFERENCES admin_users(id),
  decided_at      timestamptz,
  expires_at      timestamptz,                         -- a day after approval
  created_at      timestamptz NOT NULL,
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE INDEX segment_exports_pending_idx ON segment_exports (created_at) WHERE status = 'pending';
