-- Guardian consent for 13–17s (build plan step 2.8d, doc 10 §3.3, NDPA s.31): a parent or
-- guardian agrees with a code sent to their phone or email. When they did is kept on the user,
-- and the record itself is a consent_records row (purpose 'guardian') whose `details` say how,
-- with the guardian's number or address only masked and hashed.
ALTER TABLE users ADD COLUMN guardian_consent_at timestamptz;
ALTER TABLE consent_records ADD COLUMN details jsonb;
