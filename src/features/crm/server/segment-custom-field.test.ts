import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { crmTagIdSchema, organizationIdSchema } from "@/shared/contracts";
import { resolveCrmSegmentIn } from "./queries";

const migrations = [
  "../../../../drizzle/0000_init.sql",
  // `organization_contact_custom_fields.field_type` reuses the
  // `speaker_logistics_field_type` enum this migration defines.
  "../../../../drizzle/0008_speaker_roster_operations.sql",
  "../../../../drizzle/0010_organization_tenancy.sql",
  "../../../../drizzle/0013_speaker_crm.sql",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

const organizationId = organizationIdSchema.parse("b7000000-0000-4000-8000-000000000001");
// Contacts: (name, dietary custom field, has "vip" tag?)
const vipVegan = "b7000000-0000-4000-8000-000000000010";
const vipOmnivore = "b7000000-0000-4000-8000-000000000011";
const plainVegan = "b7000000-0000-4000-8000-000000000012";
const vipNoDiet = "b7000000-0000-4000-8000-000000000013";
const vipTagId = crmTagIdSchema.parse("b7000000-0000-4000-8000-0000000000a0");

describe("CRM segment custom-field filter", () => {
  let pg: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pg = new PGlite();
    for (const migration of migrations) await pg.exec(migration);
    tx = drizzle(pg, { schema }) as unknown as TxDb;

    await pg.query("INSERT INTO organizations(id,name,slug) VALUES ($1,'Acme','acme')", [organizationId]);
    await pg.query(
      `INSERT INTO organization_contacts(id,organization_id,email,first_name,custom_fields) VALUES
        ($1,$5,'vipvegan@example.com','VipVegan', '{"diet":"vegan","tier":"gold"}'),
        ($2,$5,'vipomni@example.com','VipOmni', '{"diet":"omnivore","tier":"gold"}'),
        ($3,$5,'plainvegan@example.com','PlainVegan', '{"diet":"vegan"}'),
        ($4,$5,'vipnodiet@example.com','VipNoDiet', '{}')`,
      [vipVegan, vipOmnivore, plainVegan, vipNoDiet, organizationId],
    );
    await pg.query(
      `INSERT INTO organization_contact_tags(id,organization_id,name) VALUES ($1,$2,'VIP')`,
      [vipTagId, organizationId],
    );
    // VIP tag on the three "vip*" contacts; PlainVegan is untagged.
    await pg.query(
      `INSERT INTO organization_contact_tag_links(organization_id,organization_contact_id,tag_id) VALUES
        ($1,$2,$5),($1,$3,$5),($1,$4,$5)`,
      [organizationId, vipVegan, vipOmnivore, vipNoDiet, vipTagId],
    );
  }, 60_000);

  afterAll(async () => pg.close());

  it("resolves a single custom-field equality to exactly the matching contacts", async () => {
    const resolved = await resolveCrmSegmentIn(tx, organizationId, { customFields: { diet: "vegan" } });
    expect(resolved.matchedCount).toBe(2);
    expect(resolved.organizationContactIds.sort()).toEqual([vipVegan, plainVegan].sort());
  });

  it("ANDs a tag with a custom-field value — only contacts carrying both", async () => {
    const resolved = await resolveCrmSegmentIn(tx, organizationId, {
      tagIds: [vipTagId],
      customFields: { diet: "vegan" },
    });
    // PlainVegan is vegan but not VIP; VipOmni is VIP but not vegan; both drop.
    expect(resolved.matchedCount).toBe(1);
    expect(resolved.organizationContactIds).toEqual([vipVegan]);
  });

  it("ANDs two custom-field values together", async () => {
    const resolved = await resolveCrmSegmentIn(tx, organizationId, {
      customFields: { diet: "vegan", tier: "gold" },
    });
    expect(resolved.organizationContactIds).toEqual([vipVegan]);
  });

  it("matches nothing when no contact carries the requested value", async () => {
    const resolved = await resolveCrmSegmentIn(tx, organizationId, { customFields: { diet: "carnivore" } });
    expect(resolved.matchedCount).toBe(0);
    expect(resolved.organizationContactIds).toEqual([]);
  });
});
