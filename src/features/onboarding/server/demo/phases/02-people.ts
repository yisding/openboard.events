import { sql } from "drizzle-orm";
import { contacts } from "@/db/schema";
import { SPEAKERS } from "../dataset";
import { demoEmail } from "../ids";
import { demoContactId, type PhaseCtx } from "./context";

/**
 * Phase 2 — eighteen speakers who do not exist.
 *
 * Written as one direct upsert rather than through a contact writer, for two
 * reasons the design settles explicitly: there is no import-shaped public
 * writer that takes a caller-supplied id (`getOrCreateContact` resolves by
 * email and mints its own), and this phase has to be able to run twice and
 * produce the same eighteen rows.
 *
 * Three properties are load-bearing rather than decorative:
 *
 * - **Every address is `<name>@<company>.demo.invalid`.** `.invalid` is
 *   reserved by RFC 2606 and has no DNS, which makes the first email rail
 *   physical rather than logical: even a total failure of the dispatcher guard
 *   delivers nothing, anywhere. `contacts` is UNIQUE on `(event_id, email)`,
 *   not globally, so these addresses are used verbatim across every tenant's
 *   demo with no mangling.
 * - **No `users` row is created, ever.** `users.email` *is* globally unique,
 *   and synthetic credentials are a line this product does not cross. The
 *   consequence is deliberate: the only human in this world is the organizer
 *   running the tour.
 * - **`headshot_file_id` is left null on all eighteen.** That is the payload
 *   for the speakers screen's "missing either" filter and for the impersonation
 *   chapter, where the organizer uploads one themselves through the real
 *   presigned path — a gap turned into a chapter.
 *
 * The roster is deliberately uneven (eleven confirmed, five unconfirmed, two
 * declined; four with no bio; three with no company) because a demo where every
 * record is complete teaches an organizer nothing about the screens that exist
 * to find the incomplete ones.
 */
export async function runPeoplePhase({ dbOrTx, eventId, now }: PhaseCtx): Promise<void> {
  await dbOrTx.insert(contacts).values(SPEAKERS.map((speaker) => ({
    id: demoContactId(eventId, speaker.key),
    eventId,
    email: demoEmail(`${speaker.firstName}.${speaker.lastName}`, speaker.emailDomainSlug),
    firstName: speaker.firstName,
    lastName: speaker.lastName,
    jobTitle: speaker.jobTitle,
    company: speaker.company,
    bioHtml: speaker.bioHtml,
    confirmationStatus: speaker.confirmationStatus,
  }))).onConflictDoUpdate({
    // The id is the conflict target rather than `(event_id, email)` because the
    // id is what every later phase names. Both constraints are satisfied by the
    // same replay: the same persona key always produces the same id *and* the
    // same address.
    target: contacts.id,
    set: {
      jobTitle: sql`excluded.job_title`,
      company: sql`excluded.company`,
      bioHtml: sql`excluded.bio_html`,
      confirmationStatus: sql`excluded.confirmation_status`,
      updatedAt: now,
    },
  });
}
