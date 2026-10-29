-- Experiments (doc 13 §4, doc 18 §11, build plan step 2.7s): a stable share of the players it is
-- for, split into variants by weight; the apps get their variant with the config and log when it
-- first changes what they see (`experiment_exposed`). Variants and audience are fixed once it runs.
-- This replaces the sketch in 0001, which nothing ever wrote to; refuse rather than lose a row.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM experiments) THEN
    RAISE EXCEPTION 'experiments has rows; move them to the new table by hand';
  END IF;
END $$;
DROP TABLE experiments;

CREATE TABLE experiments (
  key             text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]{2,39}$'),
  description     text NOT NULL,
  hypothesis      text NOT NULL,
  variants        jsonb NOT NULL,                      -- [{key, weight}], the first is the control
  audience        jsonb NOT NULL,                      -- {platforms?, min_app_version?, percent}
  primary_metric  text NOT NULL,                       -- an event, e.g. 'duel_completed'
  guardrails      text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'stopped')),
  started_at      timestamptz,
  stopped_at      timestamptz,
  created_by      text NOT NULL REFERENCES admin_users(id),
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL
);
