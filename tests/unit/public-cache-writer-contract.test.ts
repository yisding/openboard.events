import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const FORM_ID = "44444444-4444-4444-8444-444444444444";
const TASK_ID = "55555555-5555-4555-8555-555555555555";
const EMBED_ID = "66666666-6666-4666-8666-666666666666";
const REVISION_ID = "77777777-7777-4777-8777-777777777777";
const USER_ID = "88888888-8888-4888-8888-888888888888";
const REQUEST_ID = "req-public-cache-writer";

type RouteMethod = "DELETE" | "GET" | "PATCH" | "POST";
type CapturedRoute = Record<string, unknown>;
type RouteHandler = (context: Record<string, unknown>) => Promise<unknown>;

let invocationContext: Record<string, unknown> | null = null;

const invalidation = vi.hoisted(() => ({
  event: vi.fn(),
  metadata: vi.fn(),
  embed: vi.fn(),
}));

async function captureRoute(loadRoute: () => Promise<unknown>): Promise<CapturedRoute> {
  vi.resetModules();
  invocationContext = null;
  vi.doMock("@/shared/server/handler", () => ({
    defineHandler: (configuration: unknown) => {
      const handler = (configuration as { handler: RouteHandler }).handler;
      return async () => {
        if (!invocationContext) throw new Error("Route export invoked without a test context");
        return handler(invocationContext);
      };
    },
  }));
  vi.doMock("@/features/public/server/revalidate", () => ({
    revalidatePublicEvent: invalidation.event,
    revalidatePublicEventMetadata: invalidation.metadata,
    revalidatePublicEmbed: invalidation.embed,
  }));
  return await loadRoute() as CapturedRoute;
}

async function invoke(
  route: CapturedRoute,
  method: RouteMethod,
  overrides: Record<string, unknown> = {},
): Promise<unknown> {
  const exportedHandler = route[method];
  if (typeof exportedHandler !== "function") throw new Error(`Expected route to export ${method}`);

  invocationContext = {
    eventId: EVENT_ID,
    input: {},
    params: {},
    requestId: REQUEST_ID,
    session: { actorId: USER_ID },
    request: new Request("https://example.test"),
    ...overrides,
  };
  const params = (overrides.params ?? {}) as Record<string, string>;
  const request = new Request("https://example.test", method === "GET"
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: "{}" });
  try {
    return await exportedHandler(request, { params: Promise.resolve(params) });
  } finally {
    invocationContext = null;
  }
}

function expectEventInvalidations(count: number): void {
  expect(invalidation.event).toHaveBeenCalledTimes(count);
  for (const [eventId, surfaces, requestId] of invalidation.event.mock.calls) {
    expect(eventId).toBe(EVENT_ID);
    expect(surfaces).toEqual(expect.arrayContaining(["schedule", "speakers"]));
    expect(requestId).toBe(REQUEST_ID);
  }
}

const agenda = vi.hoisted(() => ({
  saveSession: vi.fn(),
  deleteSession: vi.fn(),
  moveSession: vi.fn(),
  restoreSessionContent: vi.fn(),
  bulkSetPublished: vi.fn(),
  applyPlacements: vi.fn(),
}));

vi.doMock("@/features/agenda", () => ({
  agendaAuth: vi.fn(() => vi.fn()),
  createSessionInputSchema: z.any(),
  saveSessionInputSchema: z.any(),
  listSessions: vi.fn(),
  listSessionContentRevisions: vi.fn(),
  ...agenda,
}));

const events = vi.hoisted(() => ({
  patchVocabItem: vi.fn(),
  deleteVocabItem: vi.fn(),
  updateEvent: vi.fn(),
}));

vi.doMock("@/features/events", () => ({
  vocabItemPatchSchema: z.any(),
  vocabKindSchema: z.string(),
  updateEventBodySchema: z.any(),
  getEvent: vi.fn(),
  ...events,
}));

const portal = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  getMyTask: vi.fn(),
  completeTaskManual: vi.fn(),
  completeTaskViaResponse: vi.fn(),
  importSpeakersCsv: vi.fn(),
  updateSpeakerEmail: vi.fn(),
  setConfirmationStatus: vi.fn(),
  updateSpeakerBio: vi.fn(),
  updateSpeakerHeadshot: vi.fn(),
  getSpeakerDetail: vi.fn(),
  updateSpeakerProfile: vi.fn(),
  getSpeakerRosterExtras: vi.fn(),
}));

vi.doMock("@/features/portal", () => ({
  profilePatchSchema: z.any(),
  getSpeakerProfile: vi.fn(),
  ...portal,
}));

const auth = vi.hoisted(() => ({
  requireOrganizationAdmin: vi.fn(),
}));

vi.doMock("@/features/auth", () => ({
  adminAuth: vi.fn(() => vi.fn()),
  portalAuth: vi.fn(() => vi.fn()),
  ...auth,
}));

const cfp = vi.hoisted(() => ({ submitCfpForm: vi.fn() }));
vi.doMock("@/features/cfp", () => cfp);

const lifecycle = vi.hoisted(() => ({ eraseContactData: vi.fn() }));
vi.doMock("@/features/data-lifecycle", () => lifecycle);

const organizations = vi.hoisted(() => ({ getEventOrganization: vi.fn() }));
vi.doMock("@/features/organizations", () => organizations);

const embeds = vi.hoisted(() => ({ updateEmbedConfig: vi.fn() }));
vi.doMock("@/features/public/server/embed-config-mutations", () => embeds);

describe("public-cache mutation ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agenda.saveSession.mockResolvedValue({ status: "draft", startsAt: null });
    agenda.moveSession.mockResolvedValue({ session: { status: "published", startsAt: null } });
    agenda.restoreSessionContent.mockResolvedValue({ status: "published" });
    agenda.bulkSetPublished.mockResolvedValue({ changed: 1, emailsQueued: 0 });
    agenda.applyPlacements.mockResolvedValue({
      outcomes: [{ outcome: "applied", session: { status: "published", startsAt: null } }],
    });
    portal.getSpeakerDetail.mockResolvedValue({ id: CONTACT_ID });
    portal.getSpeakerRosterExtras.mockResolvedValue({ contactId: CONTACT_ID });
    organizations.getEventOrganization.mockResolvedValue(null);
  });

  it("invalidates both public data domains after each successful agenda mutation", async () => {
    const collection = await captureRoute(() => import("../../src/app/api/internal/agenda/sessions/route"));
    await invoke(collection, "POST");

    const detail = await captureRoute(() => import("../../src/app/api/internal/agenda/sessions/[sessionId]/route"));
    await invoke(detail, "PATCH", { params: { sessionId: SESSION_ID } });
    await invoke(detail, "DELETE", { params: { sessionId: SESSION_ID }, input: { expectedVersion: 1 } });

    const move = await captureRoute(() => import("../../src/app/api/internal/agenda/sessions/[sessionId]/move/route"));
    await invoke(move, "POST", { params: { sessionId: SESSION_ID } });

    const revisions = await captureRoute(() => import("../../src/app/api/internal/agenda/sessions/[sessionId]/revisions/route"));
    await invoke(revisions, "POST", { params: { sessionId: SESSION_ID }, input: { revisionId: REVISION_ID } });

    const bulk = await captureRoute(() => import("../../src/app/api/internal/agenda/sessions/bulk-publish/route"));
    await invoke(bulk, "POST", { input: { ids: [SESSION_ID], published: true } });

    const placements = await captureRoute(() => import("../../src/app/api/internal/agenda/placements/apply/route"));
    await invoke(placements, "POST", { input: { accepted: [] } });

    expectEventInvalidations(7);
  });

  it("invalidates public data for visible vocab writes but skips internal tags", async () => {
    const route = await captureRoute(() => import("../../src/app/api/internal/events/[eventId]/vocab/[kind]/[id]/route"));
    const visibleParams = { kind: "rooms", id: SESSION_ID };
    await invoke(route, "PATCH", { params: visibleParams });
    await invoke(route, "DELETE", { params: visibleParams });
    expectEventInvalidations(2);

    invalidation.event.mockClear();
    const internalParams = { kind: "tags", id: SESSION_ID };
    await invoke(route, "PATCH", { params: internalParams });
    await invoke(route, "DELETE", { params: internalParams });
    expect(invalidation.event).not.toHaveBeenCalled();
  });

  it("invalidates successful form, portal, and speaker mutations with their conditional paths", async () => {
    const submit = await captureRoute(() => import("../../src/app/api/internal/forms/[formId]/submit/route"));
    await invoke(submit, "POST", {
      params: { formId: FORM_ID },
      session: { actorId: CONTACT_ID },
      input: { formVersion: 1, answers: {} },
    });

    const profile = await captureRoute(() => import("../../src/app/api/internal/portal/profile/route"));
    await invoke(profile, "PATCH", { session: { actorId: CONTACT_ID } });

    portal.getMyTask.mockResolvedValue({ completionMode: "form" });
    const task = await captureRoute(() => import("../../src/app/api/internal/portal/tasks/[taskId]/complete/route"));
    await invoke(task, "POST", {
      params: { taskId: TASK_ID },
      session: { actorId: CONTACT_ID },
      input: { taskId: TASK_ID, submissionId: null, answers: {} },
    });

    const csv = await captureRoute(() => import("../../src/app/api/internal/speakers/[eventId]/import/route"));
    await invoke(csv, "POST", { input: { mode: "commit" } });

    const speaker = await captureRoute(() => import("../../src/app/api/internal/speakers/[eventId]/[contactId]/route"));
    await invoke(speaker, "PATCH", {
      params: { contactId: CONTACT_ID },
      input: { confirmationStatus: "confirmed" },
    });
    await invoke(speaker, "DELETE", { params: { contactId: CONTACT_ID } });

    const roster = await captureRoute(() => import("../../src/app/api/internal/speakers/[eventId]/[contactId]/roster/route"));
    await invoke(roster, "PATCH", { params: { contactId: CONTACT_ID } });

    expectEventInvalidations(7);

    invalidation.event.mockClear();
    portal.getMyTask.mockResolvedValue({ completionMode: "manual" });
    await invoke(task, "POST", {
      params: { taskId: TASK_ID },
      session: { actorId: CONTACT_ID },
      input: { taskId: TASK_ID, submissionId: null, answers: {} },
    });
    await invoke(csv, "POST", { input: { mode: "preview" } });
    expect(invalidation.event).not.toHaveBeenCalled();
  });

  it("uses the committed event and embed results to select exact metadata tags", async () => {
    const event = await captureRoute(() => import("../../src/app/api/internal/events/[eventId]/route"));
    await invoke(event, "PATCH", { input: { patch: { name: "Changed" }, expectedRowVersion: 1 } });
    expect(invalidation.metadata).toHaveBeenCalledExactlyOnceWith(EVENT_ID, REQUEST_ID);

    embeds.updateEmbedConfig.mockResolvedValue({ contentType: "speaker_gallery" });
    const embed = await captureRoute(() => import("../../src/app/api/internal/embeds/[eventId]/[embedId]/route"));
    await invoke(embed, "PATCH", { params: { embedId: EMBED_ID } });
    expect(invalidation.embed).toHaveBeenCalledExactlyOnceWith(EVENT_ID, "speaker_gallery", REQUEST_ID);
  });
});
