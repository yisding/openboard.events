-- A new organization has no event or contact yet. Team invitations therefore
-- belong in the same product-scoped durable outbox as account verification
-- and password recovery rather than borrowing an event-scoped communication
-- row. The table keeps its historical name to avoid a risky rename in the
-- launch path; this constraint widens its supported product-mail surface.

ALTER TABLE admin_auth_email_outbox
  DROP CONSTRAINT admin_auth_email_outbox_template_ck;

ALTER TABLE admin_auth_email_outbox
  ADD CONSTRAINT admin_auth_email_outbox_template_ck
  CHECK (template_key IN (
    'admin_password_reset',
    'admin_email_verification',
    'organization_invited'
  ));
