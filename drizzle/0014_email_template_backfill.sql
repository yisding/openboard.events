-- Backfill `email_templates` rows for template keys added after an event was
-- created.
--
-- `seedDefaultTemplates` (src/features/comms/server/templates.ts) inserts one
-- row per `template_key` — but it runs at *event creation only*
-- (`createEventIn`, `src/features/events/server/mutations.ts`). Every migration
-- that appended to the `template_key` enum therefore left every pre-existing
-- event without a row for the new key, and the dispatcher treats a missing row
-- as a *terminal* failure ("email template was not found",
-- `isTerminalFailure`): the message is never retried and never delivered.
--
-- That gap was tolerable for the keys M50/M51 added (an organizer who never
-- sees a reviewer-invite mail can re-send it from a newer event). It is not
-- tolerable for `admin_password_reset` (0009_product_auth.sql): password reset
-- is a *recovery* path, `sendAdminAuthEmailIn` addresses it from the
-- organizer's oldest event membership, and for anyone whose home event predates
-- 0009 that meant the reset mail could never be delivered at all — with no
-- error surfaced to them, because the endpoint answers "if this email exists,
-- check your email" either way.
--
-- The fix is one idempotent backfill for the whole enum rather than one for the
-- offending key: the same hole reopens for every future key, and
-- `UNIQUE (event_id, key)` makes "insert every default the event is missing"
-- safe to state once. The subject/body text below is a verbatim copy of
-- `DEFAULT_TEMPLATES`; rows an event already has are left exactly as the
-- organizer edited them (`ON CONFLICT DO NOTHING`, never DO UPDATE).
--
-- Newly created events are unaffected — `seedDefaultTemplates` still seeds them
-- and still owns the defaults. This only closes the historical gap.

INSERT INTO email_templates (event_id, key, subject, body_html)
SELECT events.id, defaults.key::template_key, defaults.subject, defaults.body_html
FROM events
CROSS JOIN (VALUES
  ('submission_received', 'We received your submission — {{submission.title}}', '<p>Thanks for submitting <strong>{{submission.title}}</strong> ({{submission.code}}) to {{event.name}}.</p><p>You can track it in your portal: <a href="{{portal.magic_link}}">Open your speaker portal</a>.</p>'),
  ('submission_accepted', 'Your session was accepted for {{event.name}}', '<p>Congratulations! We accepted <strong>{{submission.title}}</strong> for {{event.name}}.</p><p>Review your next steps in the <a href="{{portal.magic_link}}">speaker portal</a>.</p>'),
  ('submission_declined', 'An update on your submission to {{event.name}}', '<p>Thank you for submitting <strong>{{submission.title}}</strong> to {{event.name}}.</p><p>We are sorry that we cannot include it in this program.</p>'),
  ('task_assigned', 'New task for {{event.name}}: {{task.name}}', '<p>A new task is ready: <strong>{{task.name}}</strong>, due {{task.due_date}}.</p><p><a href="{{portal.magic_link}}">Open your speaker portal</a> to complete it.</p>'),
  ('task_reminder', 'Reminder: {{task.name}} is due {{task.due_date}}', '<p>Here are your outstanding tasks:</p>{{tasks.outstanding_list}}<p><a href="{{portal.magic_link}}">Open your speaker portal</a>.</p><p><a href="{{unsubscribe.url}}">Unsubscribe from reminders</a>.</p>'),
  ('schedule_assigned', 'You''re scheduled: {{session.title}}', '<p><strong>{{session.title}}</strong> is scheduled for {{session.start_time_local}}–{{session.end_time_local}} {{session.timezone}} in {{session.room}}.</p>{{calendar.buttons_html}}'),
  ('schedule_changed', 'Updated time for {{session.title}}', '<p><strong>{{session.title}}</strong> is now scheduled for {{session.start_time_local}}–{{session.end_time_local}} {{session.timezone}} in {{session.room}}.</p><p>Your calendar invite has been updated.</p>{{calendar.buttons_html}}'),
  ('portal_login', 'Your sign-in code for {{event.name}}', '<p>Hi {{speaker.first_name}},</p><p>Your sign-in code is <strong>{{otp.code}}</strong>.</p><p>Or use this one-tap link: <a href="{{portal.magic_link}}">Sign in to your portal</a>.</p>'),
  ('reviewer_invited', 'You''re reviewing for {{event.name}}', '<p>Hi {{speaker.first_name}},</p><p>You have been added as a reviewer for <strong>{{event.name}}</strong> on the round “{{review.round}}”.</p><p><a href="{{review.queue_url}}">Open your review queue</a> to sign in and start scoring.</p>'),
  ('review_reminder', '{{review.outstanding}} still to review for {{event.name}}', '<p>Hi {{speaker.first_name}},</p><p>You have <strong>{{review.outstanding}}</strong> still to score in “{{review.round}}”. The round closes {{review.closes_at}}.</p><p><a href="{{review.queue_url}}">Open your review queue</a>.</p>'),
  ('speaker_bulk_message', 'A message about {{event.name}}', '<p>Hi {{speaker.first_name}},</p><p>(This default is never sent — every send overrides it.)</p>'),
  ('admin_password_reset', 'Reset your {{event.name}} organizer password', '<p>Hi {{admin.name}},</p><p>Someone asked to reset the password for this account on {{event.name}}.</p><p><a href="{{admin.action_url}}">Choose a new password</a>. The link works once and expires in {{admin.expires_in}}.</p><p>If this was not you, you can ignore this email — your password has not changed.</p>'),
  ('admin_email_verification', 'Confirm your email for {{event.name}}', '<p>Hi {{admin.name}},</p><p>Confirm this address to finish setting up your {{event.name}} organizer account.</p><p><a href="{{admin.action_url}}">Confirm your email</a>. The link works once and expires in {{admin.expires_in}}.</p>'),
  ('organization_invited', 'You''re invited to join {{invite.organization_name}}', '<p>Hi {{speaker.first_name}},</p><p>{{invite.inviter_name}} invited you to join <strong>{{invite.organization_name}}</strong> on Openboard as a {{invite.role}}.</p><p><a href="{{invite.action_url}}">Accept the invitation</a>. The link expires {{invite.expires_at}}.</p><p>If you were not expecting this, you can ignore this email.</p>')
) AS defaults(key, subject, body_html)
ON CONFLICT (event_id, key) DO NOTHING;

-- Same shape, same reason: `seedDefaultTemplates` also seeds the three default
-- reminder offsets, and an event created before that behavior existed has none.
INSERT INTO reminder_rules (event_id, offset_days)
SELECT events.id, offsets.offset_days
FROM events
CROSS JOIN (VALUES (-7), (-1), (1)) AS offsets(offset_days)
ON CONFLICT (event_id, offset_days) DO NOTHING;
