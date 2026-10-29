-- Flags, kill switches and the status banner (build plan step 2.7c). The tables come from 0001;
-- nothing has written them before. The kill switches start on.
INSERT INTO feature_flags (key, description, enabled) VALUES
  ('ads.enabled', 'Ads: rewarded videos and the ads between duels', true),
  ('shop.enabled', 'The shop and coin packs', true),
  ('party.enabled', 'Party rooms: starting and joining new ones', true)
ON CONFLICT (key) DO NOTHING;
