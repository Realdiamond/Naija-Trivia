-- Trending questions (build plan step 2.6b-3, GDD §6.2): they leave the game 90 days after going
-- live unless an editor renews them, through `valid_until` and the nightly expiry.
ALTER TABLE questions ADD COLUMN trending boolean NOT NULL DEFAULT false;
