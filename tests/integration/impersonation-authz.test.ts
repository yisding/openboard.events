import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { db as RepositoryDb, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, userIdSchema } from "@/shared/contracts";

/**
 * The authorization *ordering* inside the impersonation entry point, not the
 * shared guard underneath it.
 *
 * `createImpersonationLink` mints a link that signs an organizer in as a
 * speaker, so it is the one admin surface where getting the order wrong is
 * worse than a leak of existence: it must ask `requireAdmin` before it asks
 * whether the event exists. `tests/integration/admin-auth-better-auth.test.ts`
 * pins `authorizeAdmin`'s decisions; what it cannot see is somebody hoisting
 * the `events` lookup above the guard, which would answer NOT_FOUND to a caller
 * who was never entitled to know — an id oracle for every event in the system.
 * Hence the real exported function here, called the way a server action calls
 * it, with only its identity source and database standing in.
 */

const memberEvent = eventIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const otherEvent = eventIdSchema.parse("b0000000-0000-4000-8000-000000000002");
const unknownEvent = eventIdSchema.parse("b0000000-0000-4000-8000-0000000000ff");
const organizerUser = userIdSchema.parse("b0000000-0000-4000-8000-000000000011");
const speaker = contactIdSchema.parse("b0000000-0000-4000-8000-000000000021");
const unknownContact = contactIdSchema.parse("b0000000-0000-4000-8000-0000000000fe");

const identity = { userId: organizerUser, email: "organizer@example.com", name: "Organizer" };

let signedIn = true;
let testDb: ReturnType<typeof drizzle>;

/** The portal cookie the renewal sets, so the test can see it being handed out. */
const cookieJar = { set: vi.fn(), get: () => undefined, delete: vi.fn() };

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => cookieJar,
}));

vi.mock("@/features/auth/server/better-auth", () => ({
  getAdminAuth: () => ({
    api: {
      getSession: async () => signedIn ? { user: { id: identity.userId, email: identity.email, name: identity.name } } : null,
    },
  }),
}));

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return {
    ...actual,
    get db() {
      return testDb as unknown as typeof RepositoryDb;
    },
    // `withTx` opens a WebSocket Pool against Neon; the renewal's mint-and-spend
    // belongs in one transaction, so run it as one against PGlite.
    withTx: async (work: (handle: TxDb) => Promise<unknown>) => testDb.transaction(
      (handle) => work(handle as unknown as TxDb),
    ),
  };
});

describe("createImpersonationLink authorization order", () => {
  let pglite: PGlite;
  let createImpersonationLink: typeof import("@/features/auth/server/portal")["createImpersonationLink"];
  let renewImpersonationSession: typeof import("@/features/auth/server/portal")["renewImpersonationSession"];

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8"));
    await pglite.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Member Event','member-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),($2,'Other Event','other-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [memberEvent, otherEvent],
    );
    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,$2,$3)", [organizerUser, identity.email, identity.name]);
    await pglite.query("INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,'organizer')", [organizerUser, memberEvent]);
    await pglite.query("INSERT INTO contacts(id,event_id,email) VALUES($1,$2,'speaker@example.com')", [speaker, memberEvent]);
    testDb = drizzle(pglite, { schema });

    ({ createImpersonationLink, renewImpersonationSession } = await import("@/features/auth/server/portal"));
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllEnvs();
    await pglite.close();
  });

  it("answers FORBIDDEN for an event that does not exist, never NOT_FOUND", async () => {
    // The regression this exists to catch: reading `events` first would answer
    // NOT_FOUND here and FORBIDDEN below, and the difference between the two
    // tells an outsider which event ids are real.
    await expect(createImpersonationLink(unknownEvent, speaker)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createImpersonationLink(otherEvent, speaker)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an unauthenticated caller before anything else", async () => {
    signedIn = false;
    try {
      await expect(createImpersonationLink(unknownEvent, speaker)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      signedIn = true;
    }
  });

  it("still reports NOT_FOUND to an organizer of that event", async () => {
    // The other half of the same rule: hiding existence from outsiders must not
    // cost the people entitled to it a usable error. This is also what proves
    // the FORBIDDEN above came from the guard rather than a broken fixture.
    await expect(createImpersonationLink(memberEvent, unknownContact)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("mints a link for an organizer impersonating a contact of their own event", async () => {
    const link = await createImpersonationLink(memberEvent, speaker);
    expect(link).toMatch(/^\/portal\/member-event\/verify\?token=[^&]+&impersonate=1$/);

    const issued = await pglite.query<{ purpose: string; contact_id: string; event_id: string }>(
      "SELECT purpose,contact_id,event_id FROM portal_tokens",
    );
    expect(issued.rows).toEqual([{ purpose: "impersonation", contact_id: speaker, event_id: memberEvent }]);
  });

  /**
   * The recovery for a link that died behind its own confirm interstitial
   * (issue #673). It hands out a portal session, so it has to be as hard to
   * reach as the minting above: possession of the stale link proves only which
   * speaker the organizer picked, never that the caller may become them.
   */
  describe("renewImpersonationSession", () => {
    /** An impersonation link, aged past the point where confirming still works. */
    async function expiredLink(): Promise<string> {
      const link = await createImpersonationLink(memberEvent, speaker);
      await pglite.query("UPDATE portal_tokens SET expires_at = now() - interval '1 hour' WHERE consumed_at IS NULL");
      return new URL(link, "https://openboard.test").searchParams.get("token") ?? "";
    }

    it("reopens the portal as the same speaker, attributed to the organizer", async () => {
      const token = await expiredLink();
      cookieJar.set.mockClear();

      const session = await renewImpersonationSession({ eventSlug: "member-event", token });

      expect(session).toMatchObject({ contactId: speaker, eventId: memberEvent, email: "speaker@example.com", impersonatedByUserId: organizerUser });
      // The organizer is on the portal now — one click, not a second interstitial.
      expect(cookieJar.set).toHaveBeenCalledWith(`ob_portal_${memberEvent}`, expect.any(String), expect.objectContaining({ httpOnly: true }));
      const live = await pglite.query<{ contact_id: string; impersonated_by_user_id: string }>(
        "SELECT contact_id,impersonated_by_user_id FROM portal_sessions",
      );
      expect(live.rows).toEqual([{ contact_id: speaker, impersonated_by_user_id: organizerUser }]);
      // The replacement was spent on the way, so the renewal leaves no live
      // link lying around for whoever opens this URL next.
      const reusable = await pglite.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM portal_tokens WHERE consumed_at IS NULL AND expires_at > now()",
      );
      expect(reusable.rows[0]?.n).toBe(0);
    });

    it("refuses a caller with no admin session, and one who is not an organizer here", async () => {
      const token = await expiredLink();

      signedIn = false;
      try {
        await expect(renewImpersonationSession({ eventSlug: "member-event", token })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      } finally {
        signedIn = true;
      }
      // A link is scoped to the event that minted it: replaying this one at an
      // event the organizer has no membership in must not renew anything.
      await expect(renewImpersonationSession({ eventSlug: "other-event", token })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("refuses a token that never was an impersonation link for this event", async () => {
      await expect(renewImpersonationSession({ eventSlug: "member-event", token: "not-a-token" }))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
