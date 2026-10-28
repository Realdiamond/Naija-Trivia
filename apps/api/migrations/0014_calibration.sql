-- Difficulty calibration and quality flags (build plan step 2.6b, GDD §6.3, content doc §4).
-- The nightly job flags questions whose numbers look wrong (too hard, too easy, or most players
-- picking another answer) by filing a report that editors close like any other. `by_numbers`
-- tells these apart from players' reports, which alone count toward auto-suspension.
ALTER TABLE question_reports ADD COLUMN by_numbers boolean NOT NULL DEFAULT false;
ALTER TABLE question_reports DROP CONSTRAINT question_reports_reason_check;
ALTER TABLE question_reports ADD CONSTRAINT question_reports_reason_check
  CHECK (reason IN ('wrong_answer','outdated','offensive','typo','unfair','other','too_hard','too_easy'));
