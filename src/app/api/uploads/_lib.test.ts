import { describe, expect, it } from "vitest";
import type { ContactId, MemberRole, UserId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { assertMayFinalize, assertMayUpload, asRequester, type Uploader } from "./_lib";

const CONTACT_A = "22222222-2222-4222-8222-222222222222" as ContactId;
const CONTACT_B = "33333333-3333-4333-8333-333333333333" as ContactId;
const USER = "44444444-4444-4444-8444-444444444444" as UserId;

const admin = (role: MemberRole = "organizer"): Uploader => ({ kind: "admin", userId: USER, role });
const speaker = (contactId: ContactId = CONTACT_A): Uploader => ({ kind: "contact", contactId });

function denial(run: () => void): string {
  try {
    run();
  } catch (error) {
    return isAppError(error) ? `${error.code}: ${error.message}` : String(error);
  }
  throw new Error("expected the call to be refused");
}

describe("upload authorization", () => {
  it("keeps event branding to organizers", () => {
    for (const kind of ["logo", "background"] as const) {
      expect(() => assertMayUpload(kind, admin())).not.toThrow();
      expect(() => assertMayUpload(kind, admin("owner"))).not.toThrow();
      expect(denial(() => assertMayUpload(kind, admin("reviewer")))).toContain("FORBIDDEN");
      expect(denial(() => assertMayUpload(kind, speaker()))).toContain("FORBIDDEN");
    }
  });

  it("lets a speaker upload their own headshot, slides and file-request answers", () => {
    for (const kind of ["headshot", "slide", "attachment", "upload"] as const) {
      expect(() => assertMayUpload(kind, speaker())).not.toThrow();
      expect(() => assertMayUpload(kind, admin("reviewer"))).not.toThrow();
    }
  });
});

describe("finalize authorization", () => {
  const file = { uploadedByContactId: CONTACT_A as string, uploadedByUserId: null };

  it("lets the uploading contact finalize their own upload", () => {
    expect(() => assertMayFinalize(file, speaker(CONTACT_A))).not.toThrow();
  });

  it("refuses a contact finalizing somebody else's upload", () => {
    expect(denial(() => assertMayFinalize(file, speaker(CONTACT_B)))).toContain("FORBIDDEN");
  });

  it("refuses a contact finalizing an admin-created upload", () => {
    expect(denial(() => assertMayFinalize({ uploadedByContactId: null, uploadedByUserId: USER }, speaker())))
      .toContain("FORBIDDEN");
  });

  it("lets any admin of the event finalize", () => {
    expect(() => assertMayFinalize(file, admin("reviewer"))).not.toThrow();
  });
});

describe("requester mapping", () => {
  it("carries the role for an admin and the contact id for a speaker", () => {
    expect(asRequester(admin("owner"))).toEqual({ kind: "admin", role: "owner", userId: USER });
    expect(asRequester(speaker())).toEqual({ kind: "contact", contactId: CONTACT_A });
  });
});
