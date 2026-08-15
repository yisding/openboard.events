-- A CANCEL must retain the exact event a recipient was previously sent even
-- after the mutable session is unscheduled or hard-deleted. Backfill existing
-- invite state before making the snapshot mandatory for future REQUESTs.
ALTER TABLE "calendar_invites" ADD COLUMN "event_snapshot" jsonb;

UPDATE "calendar_invites" ci
SET "event_snapshot" = jsonb_build_object(
  'version', 1,
  'eventId', ci.event_id::text,
  'sessionId', ci.session_id::text,
  'contactId', ci.contact_id::text,
  'title', s.title,
  'descriptionHtml', s.description_html,
  'startsAt', coalesce(s.starts_at, e.starts_at),
  'endsAt', coalesce(s.ends_at, e.ends_at),
  'room', r.name,
  'track', t.name,
  'eventName', e.name,
  'eventSlug', e.slug,
  'eventLocation', e.location,
  'eventTimezone', e.timezone,
  'attendeeEmail', c.email,
  'attendeeFirstName', c.first_name,
  'attendeeLastName', c.last_name
)
FROM sessions s
JOIN events e ON e.id = s.event_id
JOIN contacts c ON c.event_id = s.event_id
LEFT JOIN rooms r ON r.id = s.room_id AND r.event_id = s.event_id
LEFT JOIN tracks t ON t.id = s.track_id AND t.event_id = s.event_id
WHERE s.id = ci.session_id AND s.event_id = ci.event_id
  AND c.id = ci.contact_id;

ALTER TABLE "calendar_invites" ALTER COLUMN "event_snapshot" SET NOT NULL;

-- A delete-only payload belongs beside the generic outbox rather than widening
-- every outbox writer. The one-to-one row survives until its communication is
-- terminal and cascades with retention/erasure of the communication log.
CREATE TABLE "calendar_cancellation_jobs" (
  "communication_log_id" uuid PRIMARY KEY REFERENCES "communication_logs"("id") ON DELETE CASCADE,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
