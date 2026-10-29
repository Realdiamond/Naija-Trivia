-- Coin packs (build plan step 2.4d): RevenueCat tells us about each store purchase. Nothing has
-- written `purchases` before.
ALTER TABLE purchases ADD COLUMN environment text NOT NULL DEFAULT 'production'
  CHECK (environment IN ('production', 'sandbox'));
ALTER TABLE purchases ADD COLUMN coins int;
ALTER TABLE purchases ADD COLUMN ledger_tx_id text REFERENCES ledger_transactions(id);
ALTER TABLE purchases ADD COLUMN refunded_at timestamptz;
CREATE INDEX purchases_user_idx ON purchases (user_id, created_at DESC);
