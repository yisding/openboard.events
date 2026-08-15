import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import * as schema from "@/db/schema";
import { calendarInvites, communicationLogs, contacts, events } from "@/db/schema";
import { deleteSessionIn, saveSessionIn } from "@/features/agenda/server/mutations";
import {
  contactIdSchema,
  eventIdSchema,
  idem,
  sessionIdSchema,
  type ContactId,
  type EventId,
  type ScheduledSessionDTO,
} from "@/shared/contracts";

const WAIT_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 5_000;
const SESSION_DURATION_MS = 30 * 60 * 1_000;
const RESCHEDULE_OFFSET_MS = 15 * 60 * 1_000;
const normalizedEmailSchema = z.string().transform((value) => value.trim().toLowerCase()).pipe(z.email());

const configSchema = z.object({
  confirm: z.literal("production"),
  databaseUrl: z.url().refine((value) => value.startsWith("postgres"), "must be a PostgreSQL URL"),
  eventSlug: z.string().trim().min(1),
  recipients: z.array(normalizedEmailSchema).length(2).transform((values) => (
    [...new Set(values)]
  )).refine((values) => values.length === 2, "two unique recipients are required"),
});

type ProbeConfig = z.infer<typeof configSchema>;
type ProbeDatabase = ReturnType<typeof createDatabase>;
type ExpectedMethod = "request" | "cancel";
type ProbeEnvironment = Partial<Record<
  "DELIVERY_PROBE_CONFIRM" | "DATABASE_URL" | "DELIVERY_PROBE_EVENT_SLUG" | "DELIVERY_PROBE_RECIPIENTS",
  string
>>;

function createDatabase(url: string) {
  return drizzle(neon(url), { schema });
}

export function readProbeConfig(environment?: ProbeEnvironment): ProbeConfig {
  const source = environment ?? {
    DELIVERY_PROBE_CONFIRM: process.env.DELIVERY_PROBE_CONFIRM,
    DATABASE_URL: process.env.DATABASE_URL,
    DELIVERY_PROBE_EVENT_SLUG: process.env.DELIVERY_PROBE_EVENT_SLUG,
    DELIVERY_PROBE_RECIPIENTS: process.env.DELIVERY_PROBE_RECIPIENTS,
  };
  return configSchema.parse({
    confirm: source.DELIVERY_PROBE_CONFIRM,
    databaseUrl: source.DATABASE_URL,
    eventSlug: source.DELIVERY_PROBE_EVENT_SLUG,
    recipients: source.DELIVERY_PROBE_RECIPIENTS?.split(",") ?? [],
  });
}

export function probeSchedule(startsAt: Date, endsAt: Date, now = new Date()): {
  initialStart: Date;
  initialEnd: Date;
  movedStart: Date;
  movedEnd: Date;
} {
  const initialStart = new Date(startsAt.getTime() + RESCHEDULE_OFFSET_MS);
  const initialEnd = new Date(initialStart.getTime() + SESSION_DURATION_MS);
  const movedStart = new Date(initialStart.getTime() + RESCHEDULE_OFFSET_MS);
  const movedEnd = new Date(movedStart.getTime() + SESSION_DURATION_MS);
  if (movedEnd > endsAt) throw new Error("probe event needs at least 60 minutes inside its configured bounds");
  if (initialStart <= now) throw new Error("probe event must still have a future delivery window");
  return { initialStart, initialEnd, movedStart, movedEnd };
}

async function waitForCalendarMessages(
  database: ProbeDatabase,
  eventId: EventId,
  sessionId: ScheduledSessionDTO["id"],
  contactIds: readonly ContactId[],
  revision: number,
  expectedMethod: ExpectedMethod,
): Promise<void> {
  const keys = contactIds.map((contactId) => idem.scheduled(eventId, sessionId, contactId, revision));
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rows = await database.select({ status: communicationLogs.status })
      .from(communicationLogs)
      .where(inArray(communicationLogs.idempotencyKey, keys));
    if (rows.some((row) => row.status === "failed" || row.status === "skipped")) {
      throw new Error(`calendar ${expectedMethod.toUpperCase()} reached a terminal non-delivery state`);
    }
    if (rows.length === keys.length && rows.every((row) => row.status === "sent")) {
      const inviteRows = await database.select({ method: calendarInvites.lastMethod })
        .from(calendarInvites)
        .where(and(
          eq(calendarInvites.eventId, eventId),
          eq(calendarInvites.sessionId, sessionId),
          inArray(calendarInvites.contactId, contactIds),
        ));
      if (inviteRows.length === contactIds.length
          && inviteRows.every((row) => row.method === expectedMethod)) return;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`calendar ${expectedMethod.toUpperCase()} delivery did not settle within ${WAIT_TIMEOUT_MS / 1_000} seconds`);
}

async function loadProbeTarget(database: ProbeDatabase, config: ProbeConfig): Promise<{
  eventId: EventId;
  startsAt: Date;
  endsAt: Date;
  contactIds: ContactId[];
}> {
  const [event] = await database.select({ id: events.id, startsAt: events.startsAt, endsAt: events.endsAt })
    .from(events)
    .where(eq(events.slug, config.eventSlug))
    .limit(1);
  if (!event) throw new Error("delivery probe event was not found");
  const eventId = eventIdSchema.parse(event.id);
  const contactRows = await database.select({ id: contacts.id, email: contacts.email })
    .from(contacts)
    .where(and(eq(contacts.eventId, eventId), inArray(contacts.email, config.recipients)));
  const contactsByEmail = new Map(contactRows.map((row) => [row.email, contactIdSchema.parse(row.id)]));
  const contactIds = config.recipients.map((email) => contactsByEmail.get(email));
  if (contactIds.some((contactId) => contactId === undefined)) {
    throw new Error("every probe recipient must already be an event contact; request a portal login first");
  }
  return {
    eventId,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    contactIds: contactIds as ContactId[],
  };
}

async function runProbe(config: ProbeConfig): Promise<void> {
  const database = createDatabase(config.databaseUrl);
  const target = await loadProbeTarget(database, config);
  const schedule = probeSchedule(target.startsAt, target.endsAt);
  let session: ScheduledSessionDTO | null = null;
  try {
    session = await saveSessionIn(database, target.eventId, {
      creationId: sessionIdSchema.parse(crypto.randomUUID()),
      title: `Openboard calendar delivery probe ${new Date().toISOString()}`,
      descriptionHtml: "<p>Controlled production deliverability probe. This temporary session is removed after REQUEST, reschedule, and CANCEL delivery.</p>",
      startsAt: schedule.initialStart.toISOString(),
      endsAt: schedule.initialEnd.toISOString(),
      speakerContactIds: target.contactIds,
      status: "published",
    });
    await waitForCalendarMessages(
      database, target.eventId, session.id, target.contactIds, session.scheduleRevision, "request",
    );
    console.log(`initial REQUEST accepted for ${target.contactIds.length} recipient(s)`);

    session = await saveSessionIn(database, target.eventId, {
      id: session.id,
      expectedVersion: session.rowVersion,
      title: session.title,
      descriptionHtml: session.descriptionHtml,
      formatId: session.formatId,
      trackId: session.trackId,
      roomId: session.roomId,
      startsAt: schedule.movedStart.toISOString(),
      endsAt: schedule.movedEnd.toISOString(),
      speakerContactIds: target.contactIds,
      status: "published",
    });
    await waitForCalendarMessages(
      database, target.eventId, session.id, target.contactIds, session.scheduleRevision, "request",
    );
    console.log(`rescheduled REQUEST accepted for ${target.contactIds.length} recipient(s)`);

    session = await saveSessionIn(database, target.eventId, {
      id: session.id,
      expectedVersion: session.rowVersion,
      title: session.title,
      descriptionHtml: session.descriptionHtml,
      formatId: session.formatId,
      trackId: session.trackId,
      roomId: session.roomId,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      speakerContactIds: [],
      status: "published",
    });
    await waitForCalendarMessages(
      database, target.eventId, session.id, target.contactIds, session.scheduleRevision, "cancel",
    );
    console.log(`CANCEL accepted for ${target.contactIds.length} recipient(s)`);
    await deleteSessionIn(database, target.eventId, session.id, session.rowVersion);
    session = null;
    console.log(JSON.stringify({ ok: true, recipients: target.contactIds.length, messages: target.contactIds.length * 3 }));
  } finally {
    // A failed canary must not leave a fake published session on the public
    // agenda. Hard delete captures a durable cancellation job for every
    // REQUEST the provider may already have accepted, including a race between
    // the last poll and this cleanup.
    if (session) await deleteSessionIn(database, target.eventId, session.id, session.rowVersion);
  }
}

if (process.argv[1] && basename(process.argv[1]) === "probe-production-calendar-delivery.ts") {
  runProbe(readProbeConfig()).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
