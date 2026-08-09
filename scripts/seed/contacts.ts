import { contacts, fileAssets } from "@/db/schema";
import { buildObjectKey } from "@/shared/server/r2";
import type { EventId, FileId } from "@/shared/contracts";
import type { SeedCtx } from "./lib/helpers";

/**
 * Owned by M17 (WS-C), and the seed module the most other things depend on:
 * submissions, sessions, the gallery, the portal and the dashboard all render
 * people.
 *
 * Deliberately uneven. A dozen identical, complete speakers demo nothing —
 * `missing_assets_v`, the dashboard's attention strip and the profile nudges
 * only have anything to say when some of these people are missing a bio or a
 * headshot, so some of them are.
 *
 * Every address is on a domain we own. A seed that mails a stranger is a seed
 * that cannot be run twice.
 */
const SPEAKERS = [
  { key: "ada", first: "Ada", last: "Lovelace", company: "Analytical Engines", title: "Principal Engineer", bio: true, headshot: true },
  { key: "grace", first: "Grace", last: "Hopper", company: "Naval Systems", title: "Rear Admiral", bio: true, headshot: true },
  { key: "alan", first: "Alan", last: "Turing", company: "Bletchley", title: "Cryptanalyst", bio: true, headshot: true },
  { key: "katherine", first: "Katherine", last: "Johnson", company: "NASA", title: "Research Mathematician", bio: true, headshot: true },
  { key: "margaret", first: "Margaret", last: "Hamilton", company: "MIT Draper", title: "Director of Software", bio: true, headshot: false },
  { key: "barbara", first: "Barbara", last: "Liskov", company: "MIT", title: "Institute Professor", bio: true, headshot: false },
  { key: "tim", first: "Tim", last: "Berners-Lee", company: "W3C", title: "Director", bio: false, headshot: true },
  { key: "radia", first: "Radia", last: "Perlman", company: "Network Protocols", title: "Fellow", bio: false, headshot: true },
  { key: "linus", first: "Linus", last: "Torvalds", company: "Linux Foundation", title: "Fellow", bio: true, headshot: true },
  { key: "sophie", first: "Sophie", last: "Wilson", company: "Broadcom", title: "Director of IC Design", bio: true, headshot: true },
  { key: "james", first: "James", last: "Gosling", company: "AWS", title: "Distinguished Engineer", bio: false, headshot: false },
  { key: "shafi", first: "Shafi", last: "Goldwasser", company: "Simons Institute", title: "Director", bio: true, headshot: true },
] as const;

/**
 * The R2 objects these rows point at are uploaded once by
 * `scripts/seed/upload-headshots.sh`, which derives the same keys. A row without
 * its object serves a 404 from `/f/{id}`, so the two must be run together.
 */
export function headshotKey(eventId: EventId, fileId: string, key: string): string {
  return buildObjectKey({ eventId, kind: "headshot", fileId: fileId as FileId, filename: `${key}.png` });
}

export async function seedContacts(ctx: SeedCtx): Promise<void> {
  const { tx, eventId } = ctx;

  for (const speaker of SPEAKERS) {
    let headshotFileId: string | null = null;
    if (speaker.headshot) {
      headshotFileId = ctx.id("file", `headshot-${speaker.key}`);
      await tx.insert(fileAssets).values({
        id: headshotFileId,
        eventId,
        kind: "headshot",
        r2Key: headshotKey(eventId, headshotFileId, speaker.key),
        filename: `${speaker.key}.png`,
        mime: "image/png",
        sizeBytes: 1024,
      }).onConflictDoUpdate({ target: fileAssets.id, set: { filename: `${speaker.key}.png` } });
    }

    await tx.insert(contacts).values({
      id: ctx.id("contact", speaker.key),
      eventId,
      email: `${speaker.key}@openboard.events`,
      firstName: speaker.first,
      lastName: speaker.last,
      company: speaker.company,
      jobTitle: speaker.title,
      bioHtml: speaker.bio
        ? `<p>${speaker.first} works on ${speaker.company.toLowerCase()} and has been shipping since before it was fashionable.</p>`
        : null,
      headshotFileId,
    }).onConflictDoUpdate({
      target: contacts.id,
      set: {
        firstName: speaker.first,
        lastName: speaker.last,
        company: speaker.company,
        jobTitle: speaker.title,
        headshotFileId,
        updatedAt: new Date(),
      },
    });
  }

  const missingBio = SPEAKERS.filter((speaker) => !speaker.bio).length;
  const missingHeadshot = SPEAKERS.filter((speaker) => !speaker.headshot).length;
  ctx.log(`seeded ${SPEAKERS.length} speakers (${missingBio} without a bio, ${missingHeadshot} without a headshot)`);
}

export const SEEDED_SPEAKER_KEYS = SPEAKERS.map((speaker) => speaker.key);
export const SEEDED_HEADSHOT_KEYS = SPEAKERS.filter((speaker) => speaker.headshot).map((speaker) => speaker.key);
