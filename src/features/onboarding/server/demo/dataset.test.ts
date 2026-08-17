import { describe, expect, it } from "vitest";
import { detectConflicts, type ScheduledSession } from "@/features/agenda/conflicts";
import { SUBMISSION_STATUSES, TEMPLATE_KEYS, type SubmissionStatus } from "@/shared/contracts";
import {
  COMM_LOG_ROWS,
  DATASET_MANIFEST,
  FILE_REQUESTS,
  FORMATS,
  FORMS,
  ROOMS,
  ROUTING_RULES,
  RESOURCE_PAGES,
  SESSIONS,
  SET_PIECE_TARGET_SLOT,
  SET_PIECE_TRAY_SESSION_KEY,
  SPEAKERS,
  SUBMISSIONS,
  TAGS,
  TASK_ASSIGNMENTS,
  TASK_DEFINITIONS,
  TRACKS,
  type DemoSession,
} from "./dataset";

// Column limits pulled straight from `@/shared/contracts/limits.ts` and the
// zod schemas that actually gate these writes (`createEventInputSchema`,
// `form_fields.max_chars`'s callers, `forms.page_heading`'s
// `varchar(15)`). Not re-exported for reuse — this list documents exactly
// what this dataset promises to respect, and a real column-limit change
// should force this file to be re-reviewed rather than silently inherit it.
const LIMITS = {
  EVENT_NAME: 200,
  SLUG: 200,
  TITLE: 255,
  PAGE_HEADING: 15,
  FIELD_LABEL: 255,
  PERSON_NAME: 120,
  RESOURCE_TITLE: 200,
} as const;

function allKeys<T extends { key: string }>(rows: readonly T[]): string[] {
  return rows.map((row) => row.key);
}

function assertUniqueKeys(label: string, rows: readonly { key: string }[]): void {
  const keys = allKeys(rows);
  expect(new Set(keys).size, `${label} has duplicate keys: ${keys.join(", ")}`).toBe(keys.length);
}

describe("DATASET_MANIFEST matches every array's actual length", () => {
  it("tracks / rooms / formats / tags", () => {
    expect(DATASET_MANIFEST.tracks).toBe(TRACKS.length);
    expect(DATASET_MANIFEST.rooms).toBe(ROOMS.length);
    expect(DATASET_MANIFEST.formats).toBe(FORMATS.length);
    expect(DATASET_MANIFEST.tags).toBe(TAGS.length);
  });

  it("speakers — exactly 18", () => {
    expect(SPEAKERS.length).toBe(18);
    expect(DATASET_MANIFEST.speakers).toBe(18);
  });

  it("forms, fields and the routing rule", () => {
    expect(DATASET_MANIFEST.forms).toBe(FORMS.length);
    expect(DATASET_MANIFEST.formFields).toBe(FORMS.reduce((n, f) => n + f.fields.length, 0));
    expect(DATASET_MANIFEST.routingRules).toBe(ROUTING_RULES.length);
  });

  it("submissions — exactly 24", () => {
    expect(SUBMISSIONS.length).toBe(24);
    expect(DATASET_MANIFEST.submissions).toBe(24);
  });

  it("sessions — exactly 20", () => {
    expect(SESSIONS.length).toBe(20);
    expect(DATASET_MANIFEST.sessions).toBe(20);
  });

  it("portal: 4 task definitions, 9 assignments, 1 file request", () => {
    expect(DATASET_MANIFEST.taskDefinitions).toBe(4);
    expect(DATASET_MANIFEST.taskAssignments).toBe(9);
    expect(DATASET_MANIFEST.fileRequests).toBe(1);
  });

  it("resources — exactly 3, one unpublished", () => {
    expect(DATASET_MANIFEST.resourcePages).toBe(3);
    expect(RESOURCE_PAGES.filter((page) => !page.published)).toHaveLength(1);
  });

  it("communications — exactly 9 rows", () => {
    expect(DATASET_MANIFEST.communicationLogs).toBe(9);
  });
});

describe("keys are unique and every cross-reference resolves", () => {
  const trackKeys = new Set(allKeys(TRACKS));
  const roomKeys = new Set(allKeys(ROOMS));
  const formatKeys = new Set(allKeys(FORMATS));
  const tagKeys = new Set(allKeys(TAGS));
  const speakerKeys = new Set(allKeys(SPEAKERS));
  const taskKeys = new Set(allKeys(TASK_DEFINITIONS));

  it("no duplicate keys within any array", () => {
    assertUniqueKeys("TRACKS", TRACKS);
    assertUniqueKeys("ROOMS", ROOMS);
    assertUniqueKeys("FORMATS", FORMATS);
    assertUniqueKeys("TAGS", TAGS);
    assertUniqueKeys("SPEAKERS", SPEAKERS);
    assertUniqueKeys("SESSIONS", SESSIONS);
    assertUniqueKeys("SUBMISSIONS", SUBMISSIONS);
    assertUniqueKeys("TASK_DEFINITIONS", TASK_DEFINITIONS);
    assertUniqueKeys("RESOURCE_PAGES", RESOURCE_PAGES);
    assertUniqueKeys("FILE_REQUESTS", FILE_REQUESTS);
    assertUniqueKeys("COMM_LOG_ROWS", COMM_LOG_ROWS);
  });

  it("every submission's track, format and speaker keys exist", () => {
    for (const submission of SUBMISSIONS) {
      expect(trackKeys.has(submission.trackKey), submission.key).toBe(true);
      expect(formatKeys.has(submission.formatKey), submission.key).toBe(true);
      for (const participant of submission.participants) {
        expect(speakerKeys.has(participant.speakerKey), `${submission.key}: ${participant.speakerKey}`).toBe(true);
      }
      for (const tag of submission.tagKeys ?? []) {
        expect(tagKeys.has(tag), `${submission.key}: ${tag}`).toBe(true);
      }
    }
  });

  it("every session's track, format, room and speaker keys exist", () => {
    for (const session of SESSIONS) {
      expect(trackKeys.has(session.trackKey), session.key).toBe(true);
      expect(formatKeys.has(session.formatKey), session.key).toBe(true);
      for (const speakerKey of session.speakerKeys) {
        expect(speakerKeys.has(speakerKey), `${session.key}: ${speakerKey}`).toBe(true);
      }
      if (session.placement) expect(roomKeys.has(session.placement.roomKey), session.key).toBe(true);
    }
  });

  it("every task assignment references a real task and a real speaker", () => {
    for (const assignment of TASK_ASSIGNMENTS) {
      expect(taskKeys.has(assignment.taskKey), JSON.stringify(assignment)).toBe(true);
      expect(speakerKeys.has(assignment.speakerKey), JSON.stringify(assignment)).toBe(true);
    }
  });

  it("every file request references a real task", () => {
    for (const request of FILE_REQUESTS) expect(taskKeys.has(request.taskKey)).toBe(true);
  });

  it("every communications log row references a real speaker and a real template key", () => {
    const validTemplateKeys = new Set<string>(TEMPLATE_KEYS);
    for (const row of COMM_LOG_ROWS) {
      expect(speakerKeys.has(row.speakerKey), row.key).toBe(true);
      expect(validTemplateKeys.has(row.templateKey), row.key).toBe(true);
    }
  });

  it("the routing rule's track and tag keys exist", () => {
    for (const rule of ROUTING_RULES) {
      expect(trackKeys.has(rule.matchTrackKey)).toBe(true);
      for (const tag of rule.addTagKeys) expect(tagKeys.has(tag)).toBe(true);
    }
  });

  it("every form field's visibility source and the conditional field itself resolve within the same form", () => {
    for (const form of FORMS) {
      const fieldKeys = new Set(form.fields.map((field) => field.key));
      for (const field of form.fields) {
        if (field.visibility) expect(fieldKeys.has(field.visibility.sourceFieldKey), `${form.key}.${field.key}`).toBe(true);
      }
    }
  });
});

describe("speakers — the deliberately uneven profile (design §2.4)", () => {
  it("11 confirmed / 5 unconfirmed / 2 declined", () => {
    const byStatus = (status: string) => SPEAKERS.filter((speaker) => speaker.confirmationStatus === status).length;
    expect(byStatus("confirmed")).toBe(11);
    expect(byStatus("unconfirmed")).toBe(5);
    expect(byStatus("declined")).toBe(2);
  });

  it("4 with no bio", () => {
    expect(SPEAKERS.filter((speaker) => speaker.bioHtml === null)).toHaveLength(4);
  });

  it("3 with no company", () => {
    expect(SPEAKERS.filter((speaker) => speaker.company === null)).toHaveLength(3);
  });

  it("every speaker has an email domain slug (zero headshots is enforced structurally — there is no headshot field at all)", () => {
    for (const speaker of SPEAKERS) expect(speaker.emailDomainSlug.length).toBeGreaterThan(0);
  });
});

describe("the CFP form's conditional field and reviewVisibility pair", () => {
  const cfp = FORMS.find((form) => form.key === "cfp");
  if (!cfp) throw new Error("cfp form missing");

  it("has 11 fields, including the conditional Workshop duration field", () => {
    expect(cfp.fields).toHaveLength(11);
    const workshopDuration = cfp.fields.find((field) => field.key === "workshop_duration");
    expect(workshopDuration?.visibility).toEqual({ sourceFieldKey: "format", op: "eq", value: "workshop" });
  });

  it("demonstrates both sides of reviewVisibility: one field opted into content, another left at the default", () => {
    const content = cfp.fields.filter((field) => field.reviewVisibility === "content");
    const unclassified = cfp.fields.filter((field) => !field.locked && field.reviewVisibility === undefined);
    expect(content.length).toBeGreaterThanOrEqual(1);
    expect(unclassified.length).toBeGreaterThanOrEqual(1);
  });

  it("every pageHeading fits forms.page_heading's varchar(15)", () => {
    for (const form of FORMS) expect(form.pageHeading.length).toBeLessThanOrEqual(LIMITS.PAGE_HEADING);
  });
});

describe("submissions — the narrative fixtures", () => {
  it("all 7 SUBMISSION_STATUSES are present, including exactly 2 drafts", () => {
    const present = new Set(SUBMISSIONS.map((submission) => submission.status));
    for (const status of SUBMISSION_STATUSES) expect(present.has(status), status).toBe(true);
    expect(SUBMISSIONS.filter((submission) => submission.status === "draft")).toHaveLength(2);
  });

  it("every status used is one of the seven canonical values", () => {
    const canonical = new Set<SubmissionStatus>(SUBMISSION_STATUSES);
    for (const submission of SUBMISSIONS) expect(canonical.has(submission.status), submission.key).toBe(true);
  });

  it("exactly 6 submissions carry a co-speaker (more than one participant)", () => {
    expect(SUBMISSIONS.filter((submission) => submission.participants.length > 1)).toHaveLength(6);
  });

  it("the debate has three co-speakers alongside its primary", () => {
    const debate = SUBMISSIONS.find((submission) => submission.key === "great-ai-debate");
    expect(debate?.participants).toHaveLength(4);
    expect(debate?.participants.filter((participant) => participant.isPrimary)).toHaveLength(1);
  });

  it("exactly one participant per submission is primary", () => {
    for (const submission of SUBMISSIONS) {
      expect(submission.participants.filter((participant) => participant.isPrimary), submission.key).toHaveLength(1);
    }
  });

  it("two near-duplicate MCP proposals exist, from different speakers", () => {
    const mcpShipping = SUBMISSIONS.filter((submission) => /Shipping MCP Servers/i.test(submission.title));
    expect(mcpShipping).toHaveLength(2);
    const primaries = mcpShipping.map((submission) => submission.participants.find((participant) => participant.isPrimary)?.speakerKey);
    expect(new Set(primaries).size).toBe(2);
  });

  it("the transparent vendor pitch exists and sits in pending", () => {
    const pitch = SUBMISSIONS.find((submission) => submission.key === "vellumatic-vendor-pitch");
    expect(pitch?.title).toBe("How Vellumatic Solves Agent Reliability");
    expect(pitch?.status).toBe("pending");
  });

  it("createdOffsetDays is always negative and within [-35, -2]", () => {
    for (const submission of SUBMISSIONS) {
      expect(submission.createdOffsetDays, submission.key).toBeLessThan(0);
      expect(submission.createdOffsetDays, submission.key).toBeGreaterThanOrEqual(-35);
      expect(submission.createdOffsetDays, submission.key).toBeLessThanOrEqual(-2);
    }
  });
});

describe("no title anywhere gives the game away", () => {
  it("no submission or session title contains ⚠ or \"Demo conflict\"", () => {
    for (const row of [...SUBMISSIONS, ...SESSIONS]) {
      expect(row.title).not.toContain("⚠");
      expect(row.title.toLowerCase()).not.toContain("demo conflict");
    }
  });
});

describe("every content string fits its column limit", () => {
  it("event name budget (the longest possible generated name)", () => {
    // "AI Engineer World’s Fair " + a 4-digit year is always far under 200.
    expect("AI Engineer World’s Fair 2026".length).toBeLessThanOrEqual(LIMITS.EVENT_NAME);
  });

  it("slugs, titles, names", () => {
    for (const submission of SUBMISSIONS) expect(submission.title.length).toBeLessThanOrEqual(LIMITS.TITLE);
    for (const session of SESSIONS) expect(session.title.length).toBeLessThanOrEqual(LIMITS.TITLE);
    for (const form of FORMS) {
      expect(form.internalName.length).toBeLessThanOrEqual(LIMITS.TITLE);
      expect(form.externalTitle.length).toBeLessThanOrEqual(LIMITS.TITLE);
    }
    for (const page of RESOURCE_PAGES) expect(page.title.length).toBeLessThanOrEqual(LIMITS.RESOURCE_TITLE);
  });

  it("field labels", () => {
    for (const form of FORMS) for (const field of form.fields) expect(field.label.length).toBeLessThanOrEqual(LIMITS.FIELD_LABEL);
  });

  it("speaker names", () => {
    for (const speaker of SPEAKERS) {
      expect(speaker.firstName.length).toBeLessThanOrEqual(LIMITS.PERSON_NAME);
      expect(speaker.lastName.length).toBeLessThanOrEqual(LIMITS.PERSON_NAME);
    }
  });
});

describe("email addresses", () => {
  it("every speaker's derivable address ends .demo.invalid", () => {
    // Speakers store the raw material for `demoEmail`, not a pre-built
    // address (design's ids.ts owns the one construction site) — this
    // reconstructs it the same way a phase runner would and checks the rail.
    for (const speaker of SPEAKERS) {
      const address = `${speaker.firstName}.${speaker.lastName}@${speaker.emailDomainSlug}.demo.invalid`.toLowerCase();
      expect(address).toMatch(/\.demo\.invalid$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Agenda geometry: exactly 2 conflicts, exactly 1 back-to-back non-conflict.
//
// Judged by the product's own `detectConflicts`, not by a re-derivation here.
// A local room-and-speaker rule would agree with the copy while the organizer
// sees something else: the real engine counts same-track overlaps too, and the
// Conflicts badge and toolbar banner both render its unfiltered total. Four
// user-facing strings promise two, so two is what the detector has to say.
// ---------------------------------------------------------------------------

type Placed = DemoSession & { placement: NonNullable<DemoSession["placement"]> };

function toMinutes(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function overlaps(a: Placed, b: Placed): boolean {
  if (a.placement.dayOffset !== b.placement.dayOffset) return false;
  const aStart = toMinutes(a.placement.start);
  const aEnd = toMinutes(a.placement.end);
  const bStart = toMinutes(b.placement.start);
  const bEnd = toMinutes(b.placement.end);
  return aStart < bEnd && bStart < aEnd;
}

function touchesButDoesNotOverlap(a: Placed, b: Placed): boolean {
  if (a.placement.dayOffset !== b.placement.dayOffset) return false;
  return toMinutes(a.placement.end) === toMinutes(b.placement.start) || toMinutes(b.placement.end) === toMinutes(a.placement.start);
}

/**
 * A placed session in the shape `detectConflicts` takes. The dataset's own
 * keys stand in for ids, which is what makes a failure message name the talk
 * rather than a uuid; the day offset is folded into the minute count so the
 * comparison needs no timezone and no clock.
 */
function toDetectorInput(session: Placed): ScheduledSession {
  const day = session.placement.dayOffset * 24 * 60;
  return {
    id: session.key,
    startsAtMs: (day + toMinutes(session.placement.start)) * 60_000,
    endsAtMs: (day + toMinutes(session.placement.end)) * 60_000,
    roomId: session.placement.roomKey,
    trackId: session.trackKey,
    speakerIds: session.speakerKeys,
  } as unknown as ScheduledSession;
}

function roomConflict(a: Placed, b: Placed): boolean {
  return a.placement.roomKey === b.placement.roomKey && overlaps(a, b);
}

function speakerConflict(a: Placed, b: Placed): boolean {
  if (!overlaps(a, b)) return false;
  return a.speakerKeys.some((speakerKey) => b.speakerKeys.includes(speakerKey));
}

describe("agenda geometry — sessions", () => {
  const placed = SESSIONS.filter((session): session is Placed => session.placement !== null);

  it("exactly 3 sessions are unscheduled, sitting in the tray", () => {
    expect(SESSIONS.filter((session) => session.placement === null)).toHaveLength(3);
  });

  it("the product's own detector finds exactly the 2 planted conflicts, and no third", () => {
    const conflicts = detectConflicts(placed.map(toDetectorInput));
    // The number the Conflicts badge and the toolbar banner render, and the
    // number `world.conflictCount` reports to the tour. It has to be the
    // number the cold open, the start fork and the provisioning screen say.
    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((conflict) => conflict.kind)).toEqual(["room", "speaker"]);
    // No same-track overlap is permitted either: `severity: "warning"` still
    // shows up in the badge, so a track collision is a third conflict as far
    // as every organizer-facing number is concerned.
    expect(conflicts.filter((conflict) => conflict.kind === "track")).toEqual([]);
    expect(conflicts.map((conflict) => [conflict.a, conflict.b])).toEqual([
      ["context-engineering", "evals-product-requirement"],
      ["agentic-commerce-cart", "sales-agent-aes-trust"],
    ]);
  });

  it("still plants the two conflicts by hand-checked geometry", () => {
    // The same two, re-derived independently of the engine — so a change that
    // broke `detectConflicts` itself could not quietly make the pair above
    // agree with a detector that had stopped detecting.
    const conflicts: Array<[string, string]> = [];
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        if (!a || !b) continue;
        if (roomConflict(a, b) || speakerConflict(a, b)) conflicts.push([a.key, b.key]);
      }
    }
    expect(conflicts).toHaveLength(2);
    expect(conflicts).toContainEqual(["context-engineering", "evals-product-requirement"]);
    expect(conflicts).toContainEqual(["sales-agent-aes-trust", "agentic-commerce-cart"]);
  });

  it("exactly 1 back-to-back pair touches without overlapping, and it is never counted as a conflict", () => {
    const touching: Array<[string, string]> = [];
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        if (!a || !b) continue;
        if (a.placement.roomKey !== b.placement.roomKey) continue;
        if (touchesButDoesNotOverlap(a, b)) {
          touching.push([a.key, b.key]);
          expect(roomConflict(a, b), `${a.key} vs ${b.key} must not overlap`).toBe(false);
        }
      }
    }
    expect(touching).toHaveLength(1);
    expect(touching).toContainEqual(["robotics-world-models", "shipping-mcp-servers"]);
  });

  it("no session ever double-books the same room at the exact same placement as itself (sanity)", () => {
    for (const session of placed) {
      expect(session.placement.start, session.key).not.toBe(session.placement.end);
    }
  });
});

describe("Chapter 7's set-piece is playable from the staging this file provisions", () => {
  const setPiece = SESSIONS.find((session) => session.key === SET_PIECE_TRAY_SESSION_KEY);
  const placed = SESSIONS.filter((session): session is Placed => session.placement !== null);

  it("leaves the talk the script names by name in the tray", () => {
    // The whole chapter: "open it from the tray and give it the Main Stage".
    // Ship it already scheduled and the step's `sessionsScheduled` objective
    // can never move, however exactly the organizer follows the instruction.
    expect(setPiece, SET_PIECE_TRAY_SESSION_KEY).toBeDefined();
    expect(setPiece?.placement, "the set-piece talk must start the tour unscheduled").toBeNull();
  });

  it("points the organizer at a slot two other talks already own", () => {
    // An empty target is a chapter with no trap in it: the badge would not
    // move, and `grid.trap` and `grid.resolve` would both narrate nothing.
    const occupants = placed.filter((session) =>
      session.placement.roomKey === SET_PIECE_TARGET_SLOT.roomKey
      && session.placement.dayOffset === SET_PIECE_TARGET_SLOT.dayOffset
      && toMinutes(session.placement.start) < toMinutes(SET_PIECE_TARGET_SLOT.end)
      && toMinutes(SET_PIECE_TARGET_SLOT.start) < toMinutes(session.placement.end));
    expect(occupants.map((session) => session.key).sort())
      .toEqual(["context-engineering", "evals-product-requirement"]);
  });

  it("makes the product's own detector agree the moment the talk lands there", () => {
    // Two planted conflicts before, four after — the +2 is the set-piece
    // talk against each of the slot's two occupants, and it is what the
    // Conflicts badge renders while `grid.trap` points at it. `grid.resolve`
    // then takes it back down, which is why this delta has to be positive.
    if (!setPiece) throw new Error("set-piece missing");
    const before = detectConflicts(placed.map(toDetectorInput));
    const after = detectConflicts(
      [...placed, { ...setPiece, placement: SET_PIECE_TARGET_SLOT }].map(toDetectorInput),
    );
    expect(before).toHaveLength(2);
    expect(after).toHaveLength(4);
    const fresh = after.filter((conflict) => [String(conflict.a), String(conflict.b)].includes(SET_PIECE_TRAY_SESSION_KEY));
    expect(fresh).toHaveLength(2);
    expect(fresh.every((conflict) => conflict.kind === "room")).toBe(true);
  });
});
