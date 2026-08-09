CREATE TABLE admin_login_attempts (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
