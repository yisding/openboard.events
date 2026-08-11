import { describe, expect, it } from "vitest";
import { chunkBulkRecipientIds } from "@/features/comms/bulk-send-attempt";
import {
  composeCrmBulkEmailInputSchema,
  organizationContactIdSchema,
  type ComposeCrmBulkEmailResult,
} from "@/shared/contracts";
import { CRM_BULK_BATCH_SIZE, mergeCrmBulkEmailResults } from "./bulk-email-helpers";

const id = (n: number) => organizationContactIdSchema.parse(`84000000-0000-4000-8000-${String(n).padStart(12, "0")}`);

describe("CRM bulk batching", () => {
  it("turns a full 2,000-member segment into schema-valid server-sized requests", () => {
    const batches = chunkBulkRecipientIds(Array.from({ length: 2_000 }, (_, index) => id(index)), CRM_BULK_BATCH_SIZE);
    expect(batches.map((batch) => batch.length)).toEqual([500, 500, 500, 500]);
    for (const organizationContactIds of batches) {
      expect(composeCrmBulkEmailInputSchema.safeParse({
        organizationContactIds,
        subject: "Update",
        bodyHtml: "<p>Hello</p>",
        mode: "send",
        sendId: "85000000-0000-4000-8000-000000000001",
      }).success).toBe(true);
    }
  });

  it("requires an idempotency id for send mode", () => {
    expect(composeCrmBulkEmailInputSchema.safeParse({
      organizationContactIds: [id(1)], subject: "Update", bodyHtml: "<p>Hello</p>", mode: "send",
    }).success).toBe(false);
  });

  it("merges per-batch outcomes", () => {
    const results: ComposeCrmBulkEmailResult[] = [
      { queued: 490, skipped: 10, errors: [], preview: null },
      { queued: 498, skipped: 1, errors: [{ organizationContactId: id(2), reason: "Not linked" }], preview: null },
    ];
    expect(mergeCrmBulkEmailResults(results)).toEqual({
      queued: 988,
      skipped: 11,
      errors: [{ organizationContactId: id(2), reason: "Not linked" }],
      preview: null,
    });
  });
});
