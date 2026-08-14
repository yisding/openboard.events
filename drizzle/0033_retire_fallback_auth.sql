-- Better Auth is now the sole admin/organizer authentication provider.
-- Migration 0009 copied every legacy credential into admin_accounts before
-- this cleanup. Erase the redundant copy and make any future write fail.
UPDATE users
SET password_hash = NULL
WHERE password_hash IS NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_password_hash_retired_ck
  CHECK (password_hash IS NULL) NOT VALID;

ALTER TABLE users
  VALIDATE CONSTRAINT users_password_hash_retired_ck;
