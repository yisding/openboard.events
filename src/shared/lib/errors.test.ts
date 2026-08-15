import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, isDefinitiveWriteFailure } from "./errors";

/**
 * The client asks this about every failed write, and the answer decides whether
 * a retry is safe. It used to be answered by sixteen separate copies under
 * eleven names, in both polarities; the cases below are the union of what those
 * copies were each asserting separately.
 */
describe("isDefinitiveWriteFailure", () => {
  it("treats a coded refusal as proof the write did not commit", () => {
    for (const code of ["VALIDATION", "CONFLICT", "STALE_WRITE", "NOT_FOUND", "FORBIDDEN", "LIMIT_REACHED"] as const) {
      expect(isDefinitiveWriteFailure(new AppError(code, "refused"))).toBe(true);
    }
  });

  it("treats INTERNAL as unknown, because the write may have committed before it threw", () => {
    expect(isDefinitiveWriteFailure(new AppError("INTERNAL", "database unavailable"))).toBe(false);
  });

  it("treats a lost or unreadable response as unknown", () => {
    expect(isDefinitiveWriteFailure(new TypeError("response lost"))).toBe(false);
    expect(isDefinitiveWriteFailure(z.object({ id: z.uuid() }).safeParse({ id: "malformed" }).error)).toBe(false);
    expect(isDefinitiveWriteFailure(undefined)).toBe(false);
    expect(isDefinitiveWriteFailure("offline")).toBe(false);
  });

  it("narrows to AppError so the refusal's own message is readable", () => {
    const error: unknown = new AppError("CONFLICT", "slug is already used");
    if (!isDefinitiveWriteFailure(error)) throw new Error("expected a definitive failure");
    expect(error.message).toBe("slug is already used");
  });
});
