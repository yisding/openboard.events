-- The notify preflight (`previewNotifyQueuesIn`) and finalize both probe
-- `communication_logs` per queued row with an EXISTS on
-- (event_id, submission_id, template_key, status). The existing indexes cover
-- (event_id, status) and (event_id, contact_id, created_at); neither serves a
-- submission-scoped probe, so a large mail history turns the preflight into a
-- per-row scan of the event's whole log.
CREATE INDEX "communication_logs_submission_idx" ON "communication_logs" ("event_id", "submission_id");
