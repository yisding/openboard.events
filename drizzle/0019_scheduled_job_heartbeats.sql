-- Production monitoring: a durable success heartbeat lets the external
-- uptime workflow detect a stopped Cron Trigger even when there is no queued
-- email work whose age would otherwise reveal the outage.

CREATE TABLE scheduled_job_heartbeats (
  job_name text PRIMARY KEY,
  last_succeeded_at timestamptz NOT NULL,
  last_duration_ms integer NOT NULL,
  CONSTRAINT scheduled_job_heartbeats_job_name_ck
    CHECK (job_name IN ('outbox', 'reminders', 'airtable', 'cleanup')),
  CONSTRAINT scheduled_job_heartbeats_duration_ck CHECK (last_duration_ms >= 0)
);
