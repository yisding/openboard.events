import { describe, expect, it } from "vitest";
import { contactIdSchema } from "@/shared/contracts";
import { bulkSendPreviewFingerprint, canSendBulkMessage, chunkContactIds, mergeBulkSendResults } from "./use-bulk-send";

const id = (n: number) => contactIdSchema.parse(`f4000000-0000-4000-8000-${String(n).padStart(12, "0")}`);

describe("bulk-send preview approval", () => {
  const original = bulkSendPreviewFingerprint({
    contactIds: [id(1), id(2)],
    previewContactId: id(1),
    subject: "Welcome",
    bodyHtml: "<p>Hello</p>",
  });

  it("approves only the exact audience, preview recipient, and message that was rendered", () => {
    expect(canSendBulkMessage({ canCompose: true, capped: false, previewFingerprint: original, currentFingerprint: original })).toBe(true);

    for (const changed of [
      bulkSendPreviewFingerprint({ contactIds: [id(1)], previewContactId: id(1), subject: "Welcome", bodyHtml: "<p>Hello</p>" }),
      bulkSendPreviewFingerprint({ contactIds: [id(1), id(2)], previewContactId: id(2), subject: "Welcome", bodyHtml: "<p>Hello</p>" }),
      bulkSendPreviewFingerprint({ contactIds: [id(1), id(2)], previewContactId: id(1), subject: "Changed", bodyHtml: "<p>Hello</p>" }),
      bulkSendPreviewFingerprint({ contactIds: [id(1), id(2)], previewContactId: id(1), subject: "Welcome", bodyHtml: "<p>Changed</p>" }),
    ]) {
      expect(canSendBulkMessage({ canCompose: true, capped: false, previewFingerprint: original, currentFingerprint: changed })).toBe(false);
    }
  });

  it("never enables a capped segment, even when its preview fingerprint matches", () => {
    expect(canSendBulkMessage({ canCompose: true, capped: true, previewFingerprint: original, currentFingerprint: original })).toBe(false);
  });
});

describe("chunkContactIds (M46 — batching a resolved segment for compose's 200-recipient cap)", () => {
  it("returns a single batch for a segment at or under the compose cap", () => {
    const ids = Array.from({ length: 200 }, (_, i) => id(i));
    expect(chunkContactIds(ids)).toEqual([ids]);
  });

  it("splits a segment above 200 into multiple compose-sized batches — the exact gap the review flagged", () => {
    const ids = Array.from({ length: 250 }, (_, i) => id(i));
    const batches = chunkContactIds(ids);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(200);
    expect(batches[1]).toHaveLength(50);
    expect(batches.flat()).toEqual(ids);
  });

  it("splits a full 2,000-recipient segment (resolveSpeakerSegmentIn's own ceiling) into ten batches", () => {
    const ids = Array.from({ length: 2_000 }, (_, i) => id(i));
    const batches = chunkContactIds(ids);
    expect(batches).toHaveLength(10);
    expect(batches.every((batch) => batch.length === 200)).toBe(true);
  });

  it("returns no batches for an empty segment", () => {
    expect(chunkContactIds([])).toEqual([]);
  });
});

describe("mergeBulkSendResults", () => {
  it("sums queued/skipped and concatenates errors across batches, in batch order", () => {
    const merged = mergeBulkSendResults([
      { queued: 180, skipped: 15, errors: [{ contactId: id(1), reason: "Not found in this event" }], preview: null },
      { queued: 40, skipped: 5, errors: [{ contactId: id(2), reason: "Not found in this event" }], preview: null },
    ]);
    expect(merged).toEqual({
      queued: 220,
      skipped: 20,
      errors: [
        { contactId: id(1), reason: "Not found in this event" },
        { contactId: id(2), reason: "Not found in this event" },
      ],
      preview: null,
    });
  });

  it("returns the zero identity for no batches", () => {
    expect(mergeBulkSendResults([])).toEqual({ queued: 0, skipped: 0, errors: [], preview: null });
  });
});
