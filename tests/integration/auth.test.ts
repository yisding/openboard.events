import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { authenticateAdmin, authorizeAdmin, hashPassword, signAdminToken, verifyAdminToken, verifyPassword } from "@/features/auth";
import { authenticateApiKey } from "@/features/auth/server/guards";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { sha256 } from "@/features/auth/server/crypto";

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const eventA = eventIdSchema.parse("a0000000-0000-4000-8000-000000000001");
const eventB = eventIdSchema.parse("a0000000-0000-4000-8000-000000000002");
const organizerId = userIdSchema.parse("a0000000-0000-4000-8000-000000000003");
const reviewerId = userIdSchema.parse("a0000000-0000-4000-8000-000000000004");
const secret = "test-session-secret-that-is-at-least-32-bytes";

describe("admin authentication", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.query("INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'A','auth-a','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z'),($2,'B','auth-b','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')", [eventA, eventB]);
    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'organizer@example.com','Organizer'),($2,'reviewer@example.com','Reviewer')", [organizerId, reviewerId]);
    await pglite.query("INSERT INTO event_members(user_id,event_id,role) VALUES($1,$3,'organizer'),($2,$3,'reviewer'),($2,$4,'owner')", [organizerId, reviewerId, eventA, eventB]);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
  }, 30_000);

  afterAll(async () => pglite.close());

  it("enforces owner-organizer-reviewer role ordering", async () => {
    const organizer = { userId: organizerId, email: "organizer@example.com", name: "Organizer" };
    const reviewer = { userId: reviewerId, email: "reviewer@example.com", name: "Reviewer" };
    await expect(authorizeAdmin(tx, organizer, eventA, "reviewer")).resolves.toMatchObject({ role: "organizer" });
    await expect(authorizeAdmin(tx, reviewer, eventA, "organizer")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorizeAdmin(tx, organizer, eventB)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(authorizeAdmin(tx, reviewer, eventB, "owner")).resolves.toMatchObject({ role: "owner" });
  });

  it("hashes passwords with PBKDF2 and rejects the wrong password", async () => {
    const encoded = await hashPassword("correct horse battery staple", new Uint8Array(16).fill(7));
    expect(encoded).toMatch(/^pbkdf2-sha256\$100000\$/u);
    await expect(verifyPassword("correct horse battery staple", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong password", encoded)).resolves.toBe(false);
  });

  it("signs expiring HS256 sessions and rejects tampering", async () => {
    const identity = { userId: organizerId, email: "organizer@example.com", name: "Organizer" };
    const token = await signAdminToken(identity, secret);
    await expect(verifyAdminToken(token, secret)).resolves.toEqual(identity);
    const parts = token.split(".");
    const signature = parts[2];
    if (!parts[0] || !parts[1] || !signature) throw new Error("expected compact JWT");
    const tampered = `${parts[0]}.${parts[1]}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    await expect(verifyAdminToken(tampered, secret)).resolves.toBeNull();
  });

  it("rate-limits unknown admin credentials without storing the email", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(authenticateAdmin("missing@example.com", "incorrect password", "192.0.2.10", tx)).resolves.toBeNull();
    }
    await expect(authenticateAdmin("missing@example.com", "incorrect password", "192.0.2.10", tx)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const attempts = await pglite.query<{ key_hash: string }>("SELECT key_hash FROM admin_login_attempts");
    expect(attempts.rows).toHaveLength(1);
    expect(attempts.rows[0]?.key_hash).not.toContain("missing@example.com");
  });

  it("authenticates an API key against a slug and awaits last-used persistence", async () => {
    const raw = "ob_live_test-api-key";
    const keyId = "a0000000-0000-4000-8000-000000000005";
    await pglite.query("INSERT INTO api_keys(id,event_id,name,key_hash) VALUES($1,$2,'Test key',$3)", [keyId, eventA, await sha256(raw)]);
    const request = new NextRequest("https://example.test/api/v1/events/auth-a/stats", { headers: { authorization: `Bearer ${raw}` } });
    await expect(authenticateApiKey(tx, request, null, { slug: "auth-a" })).resolves.toMatchObject({ actorId: keyId, eventId: eventA });
    const persisted = await pglite.query<{ last_used_at: Date | null }>("SELECT last_used_at FROM api_keys WHERE id=$1", [keyId]);
    expect(persisted.rows[0]?.last_used_at).not.toBeNull();
    await expect(authenticateApiKey(tx, request, null, { slug: "missing" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

});
