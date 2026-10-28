-- Email sign-in codes (build plan step 2.10): an email address becomes a sign-in method, kept
-- lower-cased as the identity's subject like a phone number in E.164.

ALTER TABLE auth_identities DROP CONSTRAINT auth_identities_provider_check;
ALTER TABLE auth_identities ADD CONSTRAINT auth_identities_provider_check
  CHECK (provider IN ('phone','google','apple','guest_device','email'));
