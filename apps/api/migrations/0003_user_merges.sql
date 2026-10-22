-- Guest-to-account merges (TRD FR-AUTH-4, build plan step 1.2a). When a guest signs in to an
-- account that already exists, their progress moves into it and the guest is retired. This
-- table keeps the link, so the dimension sync can copy it to analytics.user_aliases and the
-- person keeps one timeline (doc 18 §7).
CREATE TABLE user_merges (
  guest_id        text PRIMARY KEY REFERENCES users(id),
  into_user_id    text NOT NULL REFERENCES users(id),
  merged_at       timestamptz NOT NULL,
  CHECK (guest_id <> into_user_id)
);
CREATE INDEX user_merges_into_idx ON user_merges (into_user_id);
