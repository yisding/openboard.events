import { describe, expect, it } from "vitest";
import type { DbOrTx } from "@/db/client";
import { contactIdSchema, eventIdSchema, taskIdSchema } from "@/shared/contracts";
import { DELIVERABLE_BULK_LIMIT } from "../bulk-limit";
import { createFileExportJobIn } from "./export";
import { bulkRemindInputSchema } from "./mutations";

const target = {
  taskId: taskIdSchema.parse("d1000000-0000-4000-8000-000000000001"),
  contactId: contactIdSchema.parse("d1000000-0000-4000-8000-000000000002"),
  submissionId: null,
} as const;

describe("Files bulk request bound", () => {
  it("accepts 200 reminder targets and rejects 201", () => {
    expect(bulkRemindInputSchema.safeParse({
      targets: Array.from({ length: DELIVERABLE_BULK_LIMIT }, () => target),
    }).success).toBe(true);
    expect(bulkRemindInputSchema.safeParse({
      targets: Array.from({ length: DELIVERABLE_BULK_LIMIT + 1 }, () => target),
    }).success).toBe(false);
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
