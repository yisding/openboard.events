import { describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import { BULK_REMINDER_TARGET_LIMIT, contactIdSchema, eventIdSchema, taskIdSchema } from "@/shared/contracts";
import { DELIVERABLE_BULK_LIMIT } from "../bulk-limit";
import { createFileExportJobIn } from "./export";
import { bulkRemindInputSchema } from "./mutations";

const target = {
  taskId: taskIdSchema.parse("d1000000-0000-4000-8000-000000000001"),
  contactId: contactIdSchema.parse("d1000000-0000-4000-8000-000000000002"),
  submissionId: null,
} as const;

describe("Files bulk request bound", () => {
  it("keeps reminder writes below the Worker budget without shrinking exports", () => {
    expect(bulkRemindInputSchema.safeParse({
      targets: Array.from({ length: BULK_REMINDER_TARGET_LIMIT }, () => target),
      attemptId: "d1000000-0000-4000-8000-000000000004",
    }).success).toBe(true);
    expect(bulkRemindInputSchema.safeParse({
      targets: Array.from({ length: BULK_REMINDER_TARGET_LIMIT + 1 }, () => target),
    }).success).toBe(false);
    expect(bulkRemindInputSchema.safeParse({ targets: [target], attemptId: "not-a-uuid" }).success).toBe(false);
    // Rollout-era open tabs remain accepted without a durable batch id.
    expect(bulkRemindInputSchema.safeParse({ targets: [target] }).success).toBe(true);
  });

  it("rejects an over-cap export before touching persistence", async () => {
    await expect(createFileExportJobIn(
      {} as DbOrTx,
      eventIdSchema.parse("d1000000-0000-4000-8000-000000000003"),
      null,
      Array.from({ length: DELIVERABLE_BULK_LIMIT + 1 }, () => target),
      "none",
    )).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
