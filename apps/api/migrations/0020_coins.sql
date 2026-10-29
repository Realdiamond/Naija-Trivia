-- Coins and the ledger (build plan step 2.4a). The ledger tables come from 0001; nothing has
-- written them before.

-- Where grants come from and spends go. Their `balance` is not kept up to date (every grant
-- would wait on the same row): the nightly check works theirs out from the entries.
INSERT INTO ledger_accounts (id, owner_user_id, currency) VALUES
  ('system:rewards:coins', NULL, 'coins'),
  ('system:shop:coins', NULL, 'coins'),
  ('system:rewards:gems', NULL, 'gems'),
  ('system:shop:gems', NULL, 'gems');

ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_amount_nonzero CHECK (amount <> 0);
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (transaction_id);

-- What each player got from a finished duel, for its result screen (coins without any level-up).
ALTER TABLE duels ADD COLUMN coins_a int;
ALTER TABLE duels ADD COLUMN coins_b int;
ALTER TABLE duels ADD COLUMN xp_a int;
ALTER TABLE duels ADD COLUMN xp_b int;

-- The Daily's coins, next to its XP.
ALTER TABLE daily_results ADD COLUMN coins int NOT NULL DEFAULT 0;
