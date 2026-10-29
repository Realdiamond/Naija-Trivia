-- Threshold alerts (build plan step 2.7m, doc 18 §9 "Reports & alerts"): staff-made rules on a
-- metric over the last few minutes, checked by the worker. Nothing has written `alert_rules`
-- before, so its columns can change freely.

ALTER TABLE alert_rules ADD COLUMN name text NOT NULL DEFAULT '';
-- Where an alert goes: staff phones (the staff alerts of step 2.9b), email, Slack.
ALTER TABLE alert_rules ALTER COLUMN channels SET DEFAULT '{phone}';
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_channels_check
  CHECK (channels <@ ARRAY['phone', 'email', 'slack']::text[] AND cardinality(channels) > 0);
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_window_check CHECK (window_minutes BETWEEN 5 AND 1440);
-- The rule's state as of its last check: since when it has been breached (null: fine), and the value.
ALTER TABLE alert_rules ADD COLUMN firing_since timestamptz;
ALTER TABLE alert_rules ADD COLUMN last_value numeric;
ALTER TABLE alert_rules ADD COLUMN last_checked_at timestamptz;
