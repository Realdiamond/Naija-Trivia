-- Friends and blocks (build plan step 1.2b). One row per pair (user_a < user_b): pending,
-- accepted or blocked. `source` says how the request started (for the friend_added event,
-- doc 13); `updated_at` is when it was accepted or blocked.
ALTER TABLE friendships ADD COLUMN source text CHECK (source IN ('contacts','username','opponent','link','qr'));
ALTER TABLE friendships ADD COLUMN updated_at timestamptz;
-- Friends lists read the pair from either side.
CREATE INDEX friendships_user_b_idx ON friendships (user_b);
