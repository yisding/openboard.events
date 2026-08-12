-- Organizer authentication is product-scoped, not event-scoped. A new
-- self-service account has no event yet, so reset and verification messages
-- need a durable address path that does not invent an event/contact merely to
-- satisfy communication_logs' tenancy constraints.

CREATE TABLE admin_auth_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  recipient_name text NOT NULL DEFAULT '',
  template_key template_key NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status comm_status NOT NULL DEFAULT 'queued',
  subject_rendered text,
  body_rendered_html text,
  secret_payload_ciphertext bytea,
  error text,
  provider_message_id text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  suppressed_at timestamptz,
  CONSTRAINT admin_auth_email_outbox_template_ck
    CHECK (template_key IN ('admin_password_reset', 'admin_email_verification'))
);

CREATE INDEX admin_auth_email_outbox_due_idx
  ON admin_auth_email_outbox (status, next_attempt_at, locked_until, created_at);

CREATE INDEX admin_auth_email_outbox_provider_idx
  ON admin_auth_email_outbox (provider_message_id);

CREATE INDEX admin_auth_email_outbox_recipient_idx
  ON admin_auth_email_outbox (recipient_email, status, suppressed_at);
