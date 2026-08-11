import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { db as RepositoryDb } from "@/db/client";
import * as schema from "@/db/schema";
import { ADMIN_COOKIE } from "@/features/auth/cookies";
import { signAdminToken } from "@/features/auth/server/fallback-session";
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

const SECRET = "impersonation-authz-secret-that-is-at-least-32-bytes";

const memberEvent = eventIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const otherEvent = eventIdSchema.parse("b0000000-0000-4000-8000-000000000002");
const unknownEvent = eventIdSchema.parse("b0000000-0000-4000-8000-0000000000ff");
const organizerUser = userIdSchema.parse("b0000000-0000-4000-8000-000000000011");
const speaker = contactIdSchema.parse("b0000000-0000-4000-8000-000000000021");
const unknownContact = contactIdSchema.parse("b0000000-0000-4000-8000-0000000000fe");

const identity = { userId: organizerUser, email: "organizer@example.com", name: "Organizer" };

let adminCookie = "";
let testDb: ReturnType<typeof drizzle>;

// The identity source is the only half of `requireAdmin` that differs between
// providers, and under `fallback` it is a signed cookie — so the cookie jar is
// the seam, and the guard itself runs for real.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === ADMIN_COOKIE && adminCookie ? { value: adminCookie } : undefined) }),
  headers: async () => new Headers(),
}));

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return {
    ...actual,
    get db() {
      return testDb as unknown as typeof RepositoryDb;
    },
  };
});

describe("createImpersonationLink authorization order", () => {
  let pglite: PGlite;
  let createImpersonationLink: typeof import("@/features/auth/server/portal")["createImpersonationLink"];

  beforeAll(async () => {
    vi.stubEnv("SESSION_SECRET", SECRET);
    vi.stubEnv("ADMIN_AUTH_PROVIDER", "fallback");

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

    adminCookie = await signAdminToken(identity, SECRET);
    ({ createImpersonationLink } = await import("@/features/auth/server/portal"));
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
    const signedIn = adminCookie;
    adminCookie = "";
    try {
      await expect(createImpersonationLink(unknownEvent, speaker)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    } finally {
      adminCookie = signedIn;
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
});
