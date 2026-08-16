import { describe, expect, it } from "vitest";
import { foreignKeyViolation, isConstraintViolation, isUniqueViolation } from "./errors";

describe("isConstraintViolation", () => {
  it("recognizes structured constraint names through wrapped driver errors", () => {
    const error = {
      message: "Drizzle query failed",
      cause: { message: "Postgres error", cause: { constraint: "events_slug_key" } },
    };

    expect(isConstraintViolation(error, "events_slug_key")).toBe(true);
  });

  it("recognizes constraint names included in driver messages", () => {
    expect(isConstraintViolation(
      { message: "duplicate key value violates unique constraint organizations_slug_key" },
      "organizations_slug_key",
    )).toBe(true);
  });

  it("rejects unrelated and excessively deep causes", () => {
    expect(isConstraintViolation({ constraint: "other_constraint" }, "events_slug_key")).toBe(false);
    expect(isConstraintViolation({
      cause: { cause: { cause: { cause: { cause: { constraint: "events_slug_key" } } } } },
    }, "events_slug_key")).toBe(false);
  });
});

describe("isUniqueViolation", () => {
  it("recognizes the SQLSTATE through the wrapping drizzle currently applies", () => {
    expect(isUniqueViolation({ message: "Drizzle query failed", cause: { code: "23505" } })).toBe(true);
  });

  it("still recognizes it if the driver error is wrapped one level deeper", () => {
    // The previous per-feature copies probed `error.code` and `error.cause.code`
    // and stopped. One more wrapper from a drizzle or driver bump turned every
    // organizer-facing "already exists" 409 into an unmapped 500.
    expect(isUniqueViolation({
      message: "Drizzle query failed",
      cause: { message: "pool error", cause: { code: "23505" } },
    })).toBe(true);
  });

  it("falls back to the driver message when no structured code is present", () => {
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint "crm_tags_name_key"'))).toBe(true);
  });

  it("does not claim unrelated failures or causes past the bounded depth", () => {
    expect(isUniqueViolation(new Error("connection terminated"))).toBe(false);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation({ cause: { cause: { cause: { cause: { cause: { code: "23505" } } } } } })).toBe(false);
  });
});

describe("foreignKeyViolation", () => {
  it("returns the constraint name from a structured 23503 through drizzle's wrapping", () => {
    expect(foreignKeyViolation({
      message: "Drizzle query failed",
      cause: { code: "23503", constraint: "sessions_room_id_fkey" },
    })).toBe("sessions_room_id_fkey");
  });

  it("recovers the constraint name from a bare driver message", () => {
    expect(foreignKeyViolation(new Error(
      'insert or update on table "sessions" violates foreign key constraint "sessions_track_id_fkey"',
    ))).toBe("sessions_track_id_fkey");
  });

  it("reports the violation even when the driver omits a constraint name", () => {
    expect(foreignKeyViolation({ code: "23503" })).toBe("");
  });

  it("returns null for anything that is not a foreign-key failure", () => {
    expect(foreignKeyViolation(new Error("connection terminated"))).toBeNull();
    expect(foreignKeyViolation({ code: "23505" })).toBeNull();
    expect(foreignKeyViolation({ cause: { cause: { cause: { cause: { cause: { code: "23503" } } } } } })).toBeNull();
  });
});
