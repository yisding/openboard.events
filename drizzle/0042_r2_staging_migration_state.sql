CREATE TABLE "r2_staging_migration_state" (
  "singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
  "cursor" text,
  "cycle_remaining_objects" integer DEFAULT 0 NOT NULL,
  "remaining_legacy_rows" integer DEFAULT 0 NOT NULL,
  "remaining_legacy_objects" integer DEFAULT 0 NOT NULL,
  "failures" integer DEFAULT 0 NOT NULL,
  "complete" boolean DEFAULT false NOT NULL,
  "row_version" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "r2_staging_migration_state_singleton_ck" CHECK ("singleton"),
  CONSTRAINT "r2_staging_migration_state_counts_ck" CHECK (
    "cycle_remaining_objects" >= 0
    AND "remaining_legacy_rows" >= 0
    AND "remaining_legacy_objects" >= 0
    AND "failures" >= 0
    AND "row_version" >= 0
  )
);

ALTER TABLE "scheduled_job_heartbeats"
  DROP CONSTRAINT "scheduled_job_heartbeats_job_name_ck";
ALTER TABLE "scheduled_job_heartbeats"
  ADD CONSTRAINT "scheduled_job_heartbeats_job_name_ck"
  CHECK ("job_name" in ('outbox', 'reminders', 'airtable', 'cleanup', 'r2-migration'));
