-- MTP-16 §17a — a room deleted out from under a published, timed session owes
-- its continuing speakers one "schedule changed" notice, but the deletion path
-- itself sends nothing (step 17); the notice is delivered on the next resave.
--
-- The old resave path inferred that debt from revision arithmetic
-- (`schedule_revision` advanced but undelivered). That signal is ambiguous: a
-- title/description-only edit deliberately bumps the same revision and mails
-- nobody, so the *next* schedule-neutral save could not tell "owed because the
-- room vanished" from "skipped because it was a title edit" and shipped a
-- spurious email. Record the cascade's intent explicitly instead: the deletion
-- sets this flag, and the resave that discharges it clears it.
ALTER TABLE sessions
  ADD COLUMN schedule_notice_owed boolean NOT NULL DEFAULT false;
