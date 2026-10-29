-- Data Saver (build plan step 2.8b, UX §4): null now means "automatic", on when the phone or
-- browser says data is tight (Save-Data, 2G or 3G). true or false is the player's own choice.
-- Nothing could set it before this step, so every false so far meant "never chosen".
ALTER TABLE users ALTER COLUMN data_saver DROP NOT NULL;
ALTER TABLE users ALTER COLUMN data_saver DROP DEFAULT;
UPDATE users SET data_saver = NULL WHERE data_saver = false;
