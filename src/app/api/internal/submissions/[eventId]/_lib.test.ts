import { describe, expect, it } from "vitest";
import { manualAbstractSchema, toCreateSubmissionInput } from "./_lib";

const OSEI = "e0000000-0000-4000-8000-0000000000a1";
const PANELIST = "e0000000-0000-4000-8000-0000000000a2";
const REQUEST_ID = "e0000000-0000-4000-8000-0000000000a3";

function parse(body: Record<string, unknown>) {
  return manualAbstractSchema.parse({ title: "Dr. Osei's keynote", ...body });
}

/**
 * #117 — "Add abstract" is the path built for the off-CFP talk, and it used to
 * send no participants at all, so the abstract it produced was attributed to
 * nobody. These lock the attribution in.
 */
describe("manual abstract input", () => {
  it("carries the speakers through to the create input, in the order given", () => {
    const input = toCreateSubmissionInput(parse({
      participants: [
        { contactId: OSEI, role: "speaker", isPrimary: true },
        { contactId: PANELIST, role: "co_speaker", isPrimary: false },
      ],
    }));

    expect(input.participants).toEqual([
      { contactId: OSEI, role: "speaker", isPrimary: true, sortOrder: 0 },
      { contactId: PANELIST, role: "co_speaker", isPrimary: false, sortOrder: 1 },
    ]);
  });

  it("defaults a participant's role to speaker", () => {
    const input = toCreateSubmissionInput(parse({
      participants: [{ contactId: OSEI, isPrimary: true }],
    }));
    expect(input.participants[0]?.role).toBe("speaker");
  });

  it("still accepts an abstract with nobody attached", () => {
    expect(toCreateSubmissionInput(parse({})).participants).toEqual([]);
  });

  it("maps a stable creation request id while accepting legacy tabs without one", () => {
    expect(toCreateSubmissionInput(parse({ id: REQUEST_ID })).requestedSubmissionId).toBe(REQUEST_ID);
    expect(toCreateSubmissionInput(parse({})).requestedSubmissionId).toBeNull();
  });

  it("refuses a speaker list with no primary, or with two", () => {
    expect(() => parse({ participants: [{ contactId: OSEI, isPrimary: false }] })).toThrow(/exactly one primary/i);
    expect(() => parse({
      participants: [
        { contactId: OSEI, isPrimary: true },
        { contactId: PANELIST, isPrimary: true },
      ],
    })).toThrow(/exactly one primary/i);
  });

  it("refuses the same person listed twice", () => {
    expect(() => parse({
      participants: [
        { contactId: OSEI, isPrimary: true },
        { contactId: OSEI, isPrimary: false },
      ],
    })).toThrow(/listed twice/i);
  });

  it("sends nobody an email and enforces neither deadline nor limit", () => {
    const input = toCreateSubmissionInput(parse({
      participants: [{ contactId: OSEI, isPrimary: true }],
    }));
    // Attributing the talk to a speaker must not start mailing them as if they
    // had applied — the invited keynote agreed by email already knows.
    expect(input.sendConfirmation).toBe(false);
    expect(input.submitterContactId).toBeNull();
    expect(input.enforce).toEqual({ deadline: false, limit: false });
    expect(input.source).toBe("manual");
  });
});
