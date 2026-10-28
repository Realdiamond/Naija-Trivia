-- Random opponents (build plan step 2.3): the Sabi Bot is a user of its own kind, so every list
-- of players (search, friends, leaderboards, counts) leaves it out without knowing about it.
-- A new enum value can't be used in the transaction that adds it, so the bot arrives in 0018.
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'bot';
