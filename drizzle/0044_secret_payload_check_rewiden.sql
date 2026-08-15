-- `communication_logs_secret_payload_check` names the template keys whose
-- outbox row may carry a sealed one-shot credential. 0009 widened it from
-- `portal_login` alone to the three keys `enqueue-email.ts` enforces at the
-- TypeScript layer, when M42 gave the admin password-reset and
-- email-verification links the same treatment.
--
-- 0011 had to drop and recreate this constraint to swap the `template_key`
-- enum out from under it (the stored predicate pins the type with an explicit
-- cast, which would compare old-type against new-type mid-ALTER). It recreated
-- the *original* single-key predicate, silently undoing 0009's widening.
--
-- Nothing has hit it since, because live admin auth mail routes through
-- `admin_auth_email_outbox` (0022) rather than `enqueueEmail`. It is a trap
-- rather than a live break: a future caller passing `admin_password_reset`
-- with a payload satisfies `SECRET_PAYLOAD_TEMPLATE_KEYS`, then fails at INSERT
-- with a 23514 nobody would think to look for.
--
-- Restore 0009's predicate. `secret-payload-contract.test.ts` now asserts the
-- applied constraint and `enqueue-email.ts` name the same set, so the next enum
-- recreation cannot quietly narrow it again.
--
-- `NOT VALID`, and deliberately never validated. A plain ADD CONSTRAINT scans
-- every existing row while holding ACCESS EXCLUSIVE, and `communication_logs`
-- keeps its audit history indefinitely — on a busy database that scan blocks
-- outbox inserts, the dispatcher, and every UI read for its duration.
--
-- Nothing is lost by skipping validation, because the predicate being replaced
-- logically implies this one: every row that satisfied "portal_login only" also
-- satisfies "portal_login, admin_password_reset, or admin_email_verification".
-- There is no row this scan could find. And `NOT VALID` restricts only the
-- back-check: Postgres enforces the constraint on every INSERT and UPDATE from
-- the moment it exists, which is the entire point here.
--
-- Splitting the ADD and a later VALIDATE across two migrations would not help:
-- drizzle applies a pending batch in one transaction, so the ACCESS EXCLUSIVE
-- taken here is held until the batch commits and the validation scan would run
-- under it anyway.
ALTER TABLE communication_logs DROP CONSTRAINT communication_logs_secret_payload_check;

ALTER TABLE communication_logs ADD CONSTRAINT communication_logs_secret_payload_check
  CHECK (
    template_key::text IN ('portal_login', 'admin_password_reset', 'admin_email_verification')
    OR secret_payload_ciphertext IS NULL
  ) NOT VALID;
