-- Random opponents and the Sabi Bot (build plan step 2.3, TRD FR-DUEL-6).

-- The bot takes seat B of a random duel nobody joined within a minute. Its name has a space,
-- which no player's username can have, and "sabibot" is reserved too.
INSERT INTO users (id, username, display_name, status, discoverable)
VALUES ('u_sabi_bot', 'Sabi Bot', 'Sabi Bot', 'bot', false)
ON CONFLICT (id) DO NOTHING;

-- Random duels still waiting for a player, oldest first: the matchmaking pool.
CREATE INDEX duels_random_open_idx ON duels (created_at) WHERE source = 'random' AND player_b IS NULL;
