import { describe, expect, it } from "vitest";
import { isAppError } from "@/shared/lib/errors";
import type { ContactId, EventId, FileKind, UserId } from "@/shared/contracts";
import {
  KIND_POLICY,
  UPLOAD_MAX_SIZE_MB,
  assertUploadAllowed,
  buildLegacyStagingKey,
  buildObjectKey,
  buildStagingKey,
  classifyAssetObjectKey,
  decideFileAccess,
  fileExtension,
  isPublicKind,
  publicFileHeaders,
  parseStagingKey,
  rejectionForSize,
  resolvePolicy,
  sanitizeFilename,
  sniffMatchesMime,
} from "./r2";

const MB = 1024 * 1024;
const EVENT_ID = "11111111-1111-4111-8111-111111111111" as EventId;
const CONTACT_A = "22222222-2222-4222-8222-222222222222" as ContactId;
const CONTACT_B = "33333333-3333-4333-8333-333333333333" as ContactId;
const USER_ID = "44444444-4444-4444-8444-444444444444" as UserId;

function reason(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return isAppError(error) ? error.message : String(error);
  }
  throw new Error("expected the call to throw");
}

describe("kind policy", () => {
  const cases: Array<{ kind: FileKind; accepted: string; rejected: string; maxSizeMb: number }> = [
    { kind: "logo", accepted: "image/png", rejected: "image/svg+xml", maxSizeMb: 5 },
    { kind: "background", accepted: "image/webp", rejected: "application/pdf", maxSizeMb: 5 },
    { kind: "headshot", accepted: "image/jpeg", rejected: "image/gif", maxSizeMb: 5 },
    { kind: "slide", accepted: "application/pdf", rejected: "image/png", maxSizeMb: 100 },
    { kind: "attachment", accepted: "application/pdf", rejected: "text/html", maxSizeMb: 25 },
  ];

  for (const testCase of cases) {
    it(`accepts an allowlisted ${testCase.kind} and rejects one off-list mime plus one oversize value`, () => {
      expect(() => assertUploadAllowed({
        kind: testCase.kind,
        filename: "deck.pdf",
        mime: testCase.accepted,
        sizeBytes: 1024,
      })).not.toThrow();

      expect(reason(() => assertUploadAllowed({
        kind: testCase.kind,
        filename: "deck.pdf",
        mime: testCase.rejected,
        sizeBytes: 1024,
      }))).toContain("not an accepted type");

      expect(reason(() => assertUploadAllowed({
        kind: testCase.kind,
        filename: "deck.pdf",
        mime: testCase.accepted,
        sizeBytes: testCase.maxSizeMb * MB + 1,
      }))).toContain(`limited to ${testCase.maxSizeMb} MB`);
    });
  }

  it("excludes SVG from every public image kind", () => {
    for (const kind of ["logo", "background", "headshot"] as const) {
      expect(KIND_POLICY[kind].mimes).not.toContain("image/svg+xml");
      expect(isPublicKind(kind)).toBe(true);
    }
    for (const kind of ["slide", "attachment", "upload"] as const) {
      expect(isPublicKind(kind)).toBe(false);
    }
  });

  it("validates file-request uploads against the request's extensions", () => {
    const policyOverride = { extensions: ["pdf", ".PPTX"], maxSizeMb: 20 };
    expect(() => assertUploadAllowed({
      kind: "upload",
      filename: "keynote.pptx",
      mime: "application/octet-stream",
      sizeBytes: 5 * MB,
    })).toThrow();
    expect(() => assertUploadAllowed({
      kind: "upload",
      filename: "keynote.pptx",
      mime: "application/octet-stream",
      sizeBytes: 5 * MB,
      policyOverride,
    })).not.toThrow();
    expect(reason(() => assertUploadAllowed({
      kind: "upload",
      filename: "notes.txt",
      mime: "text/plain",
      sizeBytes: 1024,
      policyOverride,
    }))).toContain("accepts pdf, pptx");
    expect(reason(() => assertUploadAllowed({
      kind: "upload",
      filename: "keynote.pptx",
      mime: "application/octet-stream",
      sizeBytes: 21 * MB,
      policyOverride,
    }))).toContain("limited to 20 MB");
  });

  it("clamps a file request that asks for more than the hard ceiling", () => {
    const policy = resolvePolicy("upload", { extensions: ["zip"], maxSizeMb: 5_000 });
    expect(policy.maxBytes).toBe(UPLOAD_MAX_SIZE_MB * MB);
  });

  it("names a file request that accepts nothing instead of rejecting with an empty list", () => {
    expect(reason(() => resolvePolicy("upload", { extensions: [" ", "."], maxSizeMb: 10 })))
      .toContain("accepts no file types");
  });

  it("refuses a policy override on a fixed-allowlist kind", () => {
    expect(reason(() => resolvePolicy("headshot", { extensions: ["exe"], maxSizeMb: 999 })))
      .toContain("only valid for kind=upload");
  });

  it("rejects a non-positive or fractional declared size", () => {
    for (const sizeBytes of [0, -1, 1.5]) {
      expect(reason(() => assertUploadAllowed({ kind: "headshot", filename: "a.png", mime: "image/png", sizeBytes })))
        .toContain("positive integer");
    }
  });
});

describe("object key scheme", () => {
  it("strips traversal segments from a hostile filename", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..\\..\\windows\\system32\\cmd.exe")).toBe("cmd.exe");
    const key = buildObjectKey({ eventId: EVENT_ID, kind: "slide", fileId: "abc", filename: "../../etc/passwd" });
    expect(key).toBe(`evt_${EVENT_ID}/slide/abc/passwd`);
    expect(key).not.toContain("..");
  });

  it("normalizes unicode combining marks", () => {
    const decomposed = "cafe\u0301.png";
    const composed = "caf\u00e9.png";
    expect(decomposed).not.toBe(composed);
    expect(sanitizeFilename(decomposed)).toBe(composed);
  });

  it("truncates a 300-character name to 128 while keeping the extension", () => {
    const long = `${"a".repeat(300)}.png`;
    const sanitized = sanitizeFilename(long);
    expect(sanitized.length).toBe(128);
    expect(sanitized.endsWith(".png")).toBe(true);
    expect(fileExtension(sanitized)).toBe("png");
  });

  it("truncates on code points so a key never carries a lone surrogate", () => {
    const sanitized = sanitizeFilename(`${"\u{1F3A4}".repeat(200)}.png`);
    expect(sanitized.length).toBeLessThanOrEqual(128);
    expect(sanitized.endsWith(".png")).toBe(true);
    expect(/[\uD800-\uDFFF]/.test(sanitized.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""))).toBe(false);
    // encodeURIComponent is what buildObjectKey's URL form runs on each segment.
    expect(() => encodeURIComponent(sanitized)).not.toThrow();
  });

  it("drops control characters and falls back when nothing survives", () => {
    expect(sanitizeFilename("re\u0007port.pdf")).toBe("report.pdf");
    expect(sanitizeFilename("///")).toBe("file");
    expect(sanitizeFilename("...")).toBe("file");
  });

  it("stages the presigned PUT on a key the published object never uses", () => {
    const parts = { eventId: EVENT_ID, kind: "headshot" as const, fileId: "abc", filename: "me.png" };
    const staging = buildStagingKey(parts);
    const published = buildObjectKey(parts);
    expect(staging).toBe(`staging/evt_${EVENT_ID}/headshot/abc/me.png`);
    expect(published).toBe(`evt_${EVENT_ID}/headshot/abc/me.png`);
    expect(staging).not.toBe(published);
    expect(buildStagingKey({ ...parts, filename: "../../etc/passwd" })).toBe(`staging/evt_${EVENT_ID}/headshot/abc/passwd`);
  });

  it("versions both staging layouts and rejects near-miss keys", () => {
    const parts = { eventId: EVENT_ID, kind: "headshot" as const, fileId: "abc", filename: "me.png" };
    expect(parseStagingKey(buildLegacyStagingKey(parts))).toEqual({
      version: 1,
      eventId: EVENT_ID,
      kind: "headshot",
      fileId: "abc",
      filename: "me.png",
    });
    expect(parseStagingKey(buildStagingKey(parts))).toEqual({
      version: 2,
      eventId: EVENT_ID,
      kind: "headshot",
      fileId: "abc",
      filename: "me.png",
    });
    expect(parseStagingKey(`archive/evt_${EVENT_ID}/headshot/abc/me.png`)).toBeNull();
    expect(parseStagingKey(`staging/evt_${EVENT_ID}/unknown/abc/me.png`)).toBeNull();
    expect(parseStagingKey(`staging/evt_${EVENT_ID}/headshot/abc/nested/me.png`)).toBeNull();
  });

  it("lets finalization recognize both staging versions while downloads require the published key", () => {
    const parts = { eventId: EVENT_ID, kind: "headshot" as const, fileId: "abc", filename: "me.png" };
    expect(classifyAssetObjectKey(buildLegacyStagingKey(parts), parts)).toBe("staging-v1");
    expect(classifyAssetObjectKey(buildStagingKey(parts), parts)).toBe("staging-v2");
    expect(classifyAssetObjectKey(buildObjectKey(parts), parts)).toBe("published");
    expect(classifyAssetObjectKey(`staging/evt_${EVENT_ID}/headshot/other/me.png`, parts)).toBe("invalid");
  });
});

describe("finalized size", () => {
  it("accepts bytes within both the ceiling and what presign authorized", () => {
    expect(rejectionForSize({ kind: "slide", actualBytes: 9 * MB, authorizedBytes: 10 * MB })).toBeNull();
  });

  it("rejects an upload larger than its file request allowed, below the hard ceiling", () => {
    // The owning file request capped this at 20 MB; the kind ceiling alone would pass 90 MB.
    expect(rejectionForSize({ kind: "upload", actualBytes: 90 * MB, authorizedBytes: 20 * MB }))
      .toContain("larger than the size it was authorized for");
  });

  it("rejects anything over the kind ceiling whatever presign authorized", () => {
    expect(rejectionForSize({ kind: "headshot", actualBytes: 6 * MB, authorizedBytes: 50 * MB }))
      .toContain("limited to 5 MB");
  });
});

describe("content sniffing", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const text = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0, 0, 0, 0, 0, 0, 0]);

  it("accepts matching magic bytes and rejects a renamed file", () => {
    expect(sniffMatchesMime("image/png", png)).toBe(true);
    expect(sniffMatchesMime("image/png", text)).toBe(false);
    expect(sniffMatchesMime("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(sniffMatchesMime("image/jpeg", png)).toBe(false);
  });

  it("accepts a webp container and rejects a truncated one", () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffMatchesMime("image/webp", webp)).toBe(true);
    expect(sniffMatchesMime("image/webp", new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false);
  });

  it("does not gate mimes it has no signature for", () => {
    expect(sniffMatchesMime("application/pdf", text)).toBe(true);
  });
});

describe("public file headers", () => {
  it("serves the stored mime with the immutable cache and nosniff headers", () => {
    const headers = publicFileHeaders({ mime: "image/png", kind: "headshot", sizeBytes: 2048 });
    // The same three assertions M10's post-deploy smoke curls for.
    expect(headers.get("content-type")).toBe("image/png");
    expect(headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-length")).toBe("2048");
    expect(headers.get("content-disposition")).toBeNull();
  });

  it("forces a download for any non-image that ever becomes public", () => {
    expect(publicFileHeaders({ mime: "application/pdf", kind: "attachment" }).get("content-disposition"))
      .toBe("attachment");
  });
});

describe("authz", () => {
  it("lets an organizer of the event read any of its files", () => {
    expect(decideFileAccess({
      uploadedByContactId: CONTACT_B,
      linkedContactIds: [],
      requester: { kind: "admin", role: "organizer", userId: USER_ID },
    })).toBe(true);
  });

  it("refuses a reviewer a file no round of theirs routes to them", () => {
    // The file id alone is not a credential: a reviewer keeps it after their
    // assignment is revoked, and it says nothing about a submission they never had.
    expect(decideFileAccess({
      uploadedByContactId: CONTACT_B,
      linkedContactIds: [],
      reviewerScopedFile: false,
      requester: { kind: "admin", role: "reviewer", userId: USER_ID },
    })).toBe(false);
    expect(decideFileAccess({
      uploadedByContactId: CONTACT_B,
      linkedContactIds: [],
      requester: { kind: "admin", role: "reviewer", userId: USER_ID },
    })).toBe(false);
  });

  it("lets a reviewer read a file their round scopes to them", () => {
    expect(decideFileAccess({
      uploadedByContactId: CONTACT_B,
      linkedContactIds: [],
      reviewerScopedFile: true,
      requester: { kind: "admin", role: "reviewer", userId: USER_ID },
    })).toBe(true);
  });

  it("refuses contact A a private file belonging to contact B", () => {
    expect(decideFileAccess({
      uploadedByContactId: CONTACT_B,
      linkedContactIds: [CONTACT_B],
      requester: { kind: "contact", contactId: CONTACT_A },
    })).toBe(false);
  });

  it("lets the uploader read their own file", () => {
    expect(decideFileAccess({
      uploadedByContactId: CONTACT_A,
      linkedContactIds: [],
      requester: { kind: "contact", contactId: CONTACT_A },
    })).toBe(true);
  });

  it("lets a co-participant of the owning submission read it", () => {
    expect(decideFileAccess({
      uploadedByContactId: CONTACT_B,
      linkedContactIds: [CONTACT_B, CONTACT_A],
      requester: { kind: "contact", contactId: CONTACT_A },
    })).toBe(true);
  });

  it("refuses an unlinked contact when the file has no uploader recorded", () => {
    expect(decideFileAccess({
      uploadedByContactId: null,
      linkedContactIds: [],
      requester: { kind: "contact", contactId: CONTACT_A },
    })).toBe(false);
  });
});
