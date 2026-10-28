-- Party rooms (build plan step 2.2a). Rooms live in the API's memory while they run; a finished
-- game is saved here. Nothing has written these tables before, so the new columns need no default.

-- The name each player had in the room (a web guest has nothing else), and how they joined.
ALTER TABLE party_results ADD COLUMN name text NOT NULL;
ALTER TABLE party_results ADD COLUMN kind text NOT NULL CHECK (kind IN ('app', 'web', 'web_guest'));
CREATE INDEX party_results_user_idx ON party_results (user_id) WHERE user_id IS NOT NULL;

-- How many questions were asked, and the MVP of the night ({id, name, correct, total, fastest_ms}).
ALTER TABLE party_games ADD COLUMN questions int NOT NULL;
ALTER TABLE party_games ADD COLUMN mvp jsonb;
