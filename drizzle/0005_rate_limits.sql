-- Generic fixed-window rate-limit counter, same shape/upsert discipline as
-- admin_login_attempts (0002_admin_auth.sql): one hashed key, one row,
-- single-statement CASE-upsert from src/shared/server/rate-limit.ts. Reused
-- across every route that needs a request cap (public submit path, /api/v1)
-- instead of one bespoke table per caller.
CREATE TABLE rate_limit_buckets (
  key_hash text PRIMARY KEY,
  count integer NOT NULL DEFAULT 1 CHECK (count > 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
