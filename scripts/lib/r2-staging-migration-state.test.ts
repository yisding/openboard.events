import { describe, expect, it } from "vitest";
import { migrationStateIsVerified, parseMigrationState } from "./r2-staging-migration-state";

const valid = {
  complete: true,
  remaining_legacy_rows: "0",
  remaining_legacy_objects: 0,
  failures: "0",
  started_at: "2026-08-14T18:00:00.000Z",
  updated_at: "2026-08-14T18:16:00.000Z",
  completed_at: "2026-08-14T18:15:00.000Z",
};

describe("R2 staging migration deployment state", () => {
  it("accepts database numeric strings and verifies the full presign window", () => {
    expect(migrationStateIsVerified(parseMigrationState(valid))).toBe(true);
  });

  it.each([undefined, null, "", "not-a-number", -1, 1.5])(
    "rejects an invalid migration counter (%s)",
    (failures) => {
      expect(() => parseMigrationState({ ...valid, failures })).toThrow("invalid failure count");
    },
  );

  it("does not verify a completion recorded before the presign window elapsed", () => {
    const state = parseMigrationState({
      ...valid,
      completed_at: "2026-08-14T18:14:59.999Z",
    });
    expect(migrationStateIsVerified(state)).toBe(false);
  });
});
