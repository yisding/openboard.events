import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEMPLATE_KEYS } from "@/shared/contracts";
import { SECRET_PAYLOAD_TEMPLATE_KEYS } from "@/shared/server/enqueue-email";
import { applyProductMigrations } from "../../scripts/lib/product-migrations";

/**
 * `enqueue-email.ts` decides at the TypeScript layer which template keys may
 * carry a sealed credential; `communication_logs_secret_payload_check` decides
 * it in the database. They must name the same set, and once did not: 0009
 * widened the constraint to three keys, 0011 dropped and recreated it to swap
 * the `template_key` enum and quietly restored the original one-key predicate,
 * and 0044 put it back.
 *
 * Asserted by inserting rather than by parsing the constraint's text, so this
 * survives any rewrite of the predicate and fails only when the answer changes.
 */
const eventId = "d4400000-0000-4000-8000-000000000001";
const contactId = "d4400000-0000-4000-8000-000000000002";

let db: PGlite;

describe("secret payload template keys", () => {
  beforeAll(async () => {
    db = new PGlite();
    await applyProductMigrations(db);
    await db.query(
      "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Secret Payload Conf','secret-payload-conf','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await db.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'recipient@example.com','Reci','Pient')",
      [contactId, eventId],
    );
  }, 120_000);

  afterAll(async () => db.close());

  async function acceptsCiphertext(templateKey: string): Promise<boolean> {
    try {
      await db.query(
        `INSERT INTO communication_logs(event_id,contact_id,template_key,idempotency_key,secret_payload_ciphertext)
         VALUES($1,$2,$3,$4,'\\x00'::bytea)`,
        [eventId, contactId, templateKey, `secret:${templateKey}`],
      );
      return true;
    } catch {
      return false;
    }
  }

  it("lets the database and enqueueEmail agree on every template key", async () => {
    for (const templateKey of TEMPLATE_KEYS) {
      const expected = SECRET_PAYLOAD_TEMPLATE_KEYS.has(templateKey);
      // Named in the assertion so a failure says which key drifted, rather than
      // just "expected false to be true".
      expect({ templateKey, accepted: await acceptsCiphertext(templateKey) })
        .toEqual({ templateKey, accepted: expected });
    }
  });

  it("still accepts a row with no payload for every key", async () => {
    // The constraint's other half: it restricts the ciphertext, not the key.
    for (const templateKey of TEMPLATE_KEYS) {
      await expect(db.query(
        "INSERT INTO communication_logs(event_id,contact_id,template_key,idempotency_key) VALUES($1,$2,$3,$4)",
        [eventId, contactId, templateKey, `plain:${templateKey}`],
      )).resolves.toBeDefined();
    }
  });
});
