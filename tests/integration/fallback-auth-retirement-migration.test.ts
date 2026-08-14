import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const initial = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const retirement = readFileSync(new URL("../../drizzle/0033_retire_fallback_auth.sql", import.meta.url), "utf8");

describe("fallback auth retirement migration", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(initial);
    await database.query(
      "INSERT INTO users(email,name,password_hash) VALUES('legacy@example.com','Legacy','retired-hash')",
    );
    await database.exec(retirement);
  });

  afterAll(async () => database.close());

  it("erases legacy credentials and rejects any new copy", async () => {
    const result = await database.query<{ password_hash: string | null }>(
      "SELECT password_hash FROM users WHERE email='legacy@example.com'",
    );
    expect(result.rows).toEqual([{ password_hash: null }]);
    await expect(database.query(
      "UPDATE users SET password_hash='reintroduced' WHERE email='legacy@example.com'",
    )).rejects.toThrow(/users_password_hash_retired_ck/u);
  });
});
