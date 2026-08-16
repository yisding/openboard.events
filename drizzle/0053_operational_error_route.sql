-- Issue #626 — `operational_error_buckets` could not attribute a 500 to a
-- route. `recordOperationalErrorIn` persisted only fingerprint/feature/code/
-- minute, silently dropping the `route` its own context type already declared
-- and `src/instrumentation.ts` already populated. The pager in
-- `docs/runbooks/alerting.md` fires on `errors.recentCount > 0`, so triage had
-- nothing durable naming the endpoint and degraded to grepping Workers Logs by
-- timestamp.
--
-- `route` joins the bucket's identity rather than riding along as a payload
-- column. Two endpoints that happen to share a fingerprint, feature, and code
-- inside one minute are two different failures to whoever is paged, and a
-- coalesce-on-conflict column would have named only whichever arrived first —
-- exactly the ambiguity this is meant to remove.
--
-- Existing rows take `''`, the same "route unknown" value written by the
-- callers that have no request to name (the private job adapter, the R2 seam).
-- The table is a seven-day aggregate with no foreign keys pointing at it, so
-- restating the primary key costs nothing beyond the statement itself.
ALTER TABLE operational_error_buckets
  ADD COLUMN route text NOT NULL DEFAULT '';

ALTER TABLE operational_error_buckets
  DROP CONSTRAINT operational_error_buckets_pkey;

ALTER TABLE operational_error_buckets
  ADD CONSTRAINT operational_error_buckets_pkey
  PRIMARY KEY (fingerprint, feature, code, route, bucket_started_at);
