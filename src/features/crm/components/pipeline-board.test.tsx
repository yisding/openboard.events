/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  crmPipelineEntryDtoSchema,
  eventIdSchema,
  organizationContactIdSchema,
  organizationContactHistoryDtoSchema,
  organizationContactSummaryDtoSchema,
  organizationIdSchema,
  type CrmPipelineEntryDTO,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { PipelineBoard } from "./pipeline-board";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("./crm-nav", () => ({ CrmNav: () => null }));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: class PointerSensor {},
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, isDragging: false }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: () => ({}),
  useSensors: () => [],
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = organizationIdSchema.parse("c8000000-0000-4000-8000-000000000001");
const contactId = organizationContactIdSchema.parse("c8000000-0000-4000-8000-000000000002");
const canonicalContactId = organizationContactIdSchema.parse("c8000000-0000-4000-8000-000000000004");
const latestContactId = organizationContactIdSchema.parse("c8000000-0000-4000-8000-000000000005");
const eventId = eventIdSchema.parse("c8000000-0000-4000-8000-000000000003");
const contact = organizationContactSummaryDtoSchema.parse({
  id: contactId,
  email: "ada@example.com",
  firstName: "Ada",
  lastName: "Speaker",
  company: "Analytical Engines",
  jobTitle: null,
  bioHtml: null,
  linkedinUrl: null,
  twitterUrl: null,
  websiteUrl: null,
  source: "manual",
  customFields: {},
  mergedIntoId: null,
  createdAt: "2026-08-13T18:00:00.000Z",
  updatedAt: "2026-08-13T18:00:00.000Z",
  tags: [],
  eventCount: 0,
  lastActivityAt: null,
});
const canonicalContact = organizationContactSummaryDtoSchema.parse({
  ...contact,
  id: canonicalContactId,
  email: "grace@example.com",
  firstName: "Grace",
  lastName: "Hopper",
  company: "Compiler Systems",
  updatedAt: "2026-08-13T18:06:00.000Z",
});
const latestContact = organizationContactSummaryDtoSchema.parse({
  ...contact,
  id: latestContactId,
  email: "katherine@example.com",
  firstName: "Katherine",
  lastName: "Johnson",
  company: "Orbital Mechanics",
  updatedAt: "2026-08-13T18:07:00.000Z",
});
const events = [{
  id: eventId,
  name: "Open Source Summit",
  slug: "open-source-summit",
  startsAt: "2026-09-15T16:00:00.000Z",
  endsAt: "2026-09-17T01:00:00.000Z",
}];

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function changeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function pickContact() {
  await act(async () => buttonNamed("Add prospect")?.click());
  const search = container.querySelector<HTMLInputElement>('input[aria-label="Search the directory"]');
  if (!search) throw new Error("Search input was not rendered");
  await changeValue(search, "ada@example.com");
  await act(async () => {
    search.closest("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  const result = container.querySelector<HTMLButtonElement>(".speaker-card");
  if (!result) throw new Error("Search result was not rendered");
  await act(async () => result.click());
}

async function renderBoard(
  initialEntries: CrmPipelineEntryDTO[] = [],
  initialContacts: Record<string, { id: typeof contactId; name: string; email: string; company: string | null }> = {},
) {
  await act(async () => {
    root.render(<PipelineBoard organizationId={organizationId} initialEntries={initialEntries} contactsById={initialContacts} events={events} />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("CRM prospect creation recovery", () => {
  it("retries one frozen request and adds exactly one confirmed card", async () => {
    let pipelineAttempts = 0;
    let pipelineReads = 0;
    let pipelineId = "";
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      if (path.endsWith(`/crm/contacts/${contactId}`)) {
        return organizationContactHistoryDtoSchema.parse({ contact, tags: [], events: [], notes: [], activity: [] });
      }
      if (init?.body) {
        pipelineAttempts += 1;
        pipelineId = String(init.body.id);
        if (pipelineAttempts === 1) throw new TypeError("connection lost after commit");
      } else {
        pipelineReads += 1;
      }
      const entry = crmPipelineEntryDtoSchema.parse({
        id: pipelineId,
        organizationContactId: contactId,
        targetEventId: eventId,
        stage: "open",
        notes: "Follow up after the keynote",
        createdAt: "2026-08-13T18:05:00.000Z",
        updatedAt: "2026-08-13T18:05:00.000Z",
      });
      return init?.body ? entry : [entry];
    });
    await renderBoard();
    await pickContact();

    const target = container.querySelector<HTMLSelectElement>(".modal-body select");
    const notes = container.querySelector<HTMLTextAreaElement>(".modal-body textarea");
    if (!target || !notes) throw new Error("Prospect fields were not rendered");
    await changeValue(target, eventId);
    await changeValue(notes, "Follow up after the keynote");

    await act(async () => {
      buttonNamed("Add to pipeline")?.click();
      await Promise.resolve();
    });

    const createCalls = () => apiMock.mock.calls.filter(([path, , init]) => String(path).endsWith("/crm/pipeline") && init?.body);
    const firstBody = createCalls()[0]?.[2]?.body;
    expect(firstBody).toMatchObject({
      id: expect.any(String),
      organizationContactId: contactId,
      targetEventId: eventId,
      notes: "Follow up after the keynote",
    });
    expect(buttonNamed("Retry addition")).toBeDefined();
    expect(buttonNamed("Close and check pipeline")).toBeDefined();
    expect(container.querySelector<HTMLFieldSetElement>(".modal-body fieldset")?.disabled).toBe(true);

    await act(async () => {
      buttonNamed("Retry addition")?.click();
      await Promise.resolve();
    });

    expect(createCalls()).toHaveLength(2);
    expect(createCalls()[1]?.[2]?.body).toEqual(firstBody);
    expect(pipelineReads).toBe(2);
    expect(container.querySelectorAll(".crm-board-card")).toHaveLength(1);
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("Ada Speaker");
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("Follow up after the keynote");
    expect(container.querySelector('dialog[aria-label="Add a prospect"]')).toBeNull();
    expect(toastMock).toHaveBeenCalledWith("Added to the pipeline");
  });

  it("resolves a merge that commits after a matching create response was read", async () => {
    let pipelineId = "";
    let pipelinePosts = 0;
    let pipelineReads = 0;
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      if (path.endsWith(`/crm/contacts/${canonicalContactId}`)) {
        return organizationContactHistoryDtoSchema.parse({ contact: canonicalContact, tags: [], events: [], notes: [], activity: [] });
      }
      if (path.endsWith("/crm/pipeline") && init?.body) {
        pipelinePosts += 1;
        pipelineId = String(init.body.id);
        return crmPipelineEntryDtoSchema.parse({
          id: pipelineId,
          organizationContactId: contactId,
          targetEventId: null,
          stage: "open",
          notes: "Merged after the response read",
          createdAt: "2026-08-13T18:05:00.000Z",
          updatedAt: "2026-08-13T18:05:00.000Z",
        });
      }
      if (path.endsWith("/crm/pipeline")) {
        pipelineReads += 1;
        return [crmPipelineEntryDtoSchema.parse({
          id: pipelineId,
          organizationContactId: canonicalContactId,
          targetEventId: null,
          stage: "open",
          notes: "Merged after the response read",
          createdAt: "2026-08-13T18:05:00.000Z",
          updatedAt: "2026-08-13T18:06:00.000Z",
        })];
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderBoard();
    await pickContact();
    const notes = container.querySelector<HTMLTextAreaElement>(".modal-body textarea");
    if (!notes) throw new Error("Prospect notes were not rendered");
    await changeValue(notes, "Merged after the response read");
    await act(async () => {
      buttonNamed("Add to pipeline")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pipelinePosts).toBe(1);
    expect(pipelineReads).toBe(2);
    expect(apiMock.mock.calls.filter(([path]) => String(path).endsWith(`/crm/contacts/${canonicalContactId}`))).toHaveLength(1);
    expect(container.querySelectorAll(".crm-board-card")).toHaveLength(1);
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("Grace Hopper");
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("grace@example.com");
    expect(container.querySelector(".crm-board-card")?.textContent).not.toContain("Ada Speaker");
    expect(container.querySelector(".crm-board-card")?.textContent).not.toContain("Unknown contact");
    expect(toastMock.mock.calls.filter(([message]) => message === "Added to the pipeline")).toHaveLength(1);
  });

  it("follows a second merge before materializing the latest canonical replay", async () => {
    let pipelineAttempts = 0;
    let pipelineReads = 0;
    let pipelineId = "";
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      if (path.endsWith(`/crm/contacts/${canonicalContactId}`)) {
        return organizationContactHistoryDtoSchema.parse({
          contact: { ...canonicalContact, mergedIntoId: latestContactId },
          tags: [],
          events: [],
          notes: [],
          activity: [],
        });
      }
      if (path.endsWith(`/crm/contacts/${latestContactId}`)) {
        return organizationContactHistoryDtoSchema.parse({ contact: latestContact, tags: [], events: [], notes: [], activity: [] });
      }
      if (path.endsWith("/crm/pipeline") && init?.body) {
        pipelineAttempts += 1;
        pipelineId = String(init.body.id);
        if (pipelineAttempts === 1) throw new TypeError("connection lost after commit");
        return crmPipelineEntryDtoSchema.parse({
          id: pipelineId,
          organizationContactId: canonicalContactId,
          targetEventId: eventId,
          stage: "open",
          notes: "Merged twice while the response was lost",
          createdAt: "2026-08-13T18:05:00.000Z",
          updatedAt: "2026-08-13T18:06:00.000Z",
        });
      }
      pipelineReads += 1;
      const organizationContactId = pipelineReads === 1 ? canonicalContactId : latestContactId;
      return [crmPipelineEntryDtoSchema.parse({
        id: pipelineId,
        organizationContactId,
        targetEventId: eventId,
        stage: "open",
        notes: "Merged twice while the response was lost",
        createdAt: "2026-08-13T18:05:00.000Z",
        updatedAt: pipelineReads === 1 ? "2026-08-13T18:06:00.000Z" : "2026-08-13T18:07:00.000Z",
      })];
    });
    await renderBoard();
    await pickContact();

    await act(async () => {
      buttonNamed("Add to pipeline")?.click();
      await Promise.resolve();
    });
    const createCalls = () => apiMock.mock.calls.filter(([path, , init]) => String(path).endsWith("/crm/pipeline") && init?.body);
    const firstBody = createCalls()[0]?.[2]?.body;

    await act(async () => {
      buttonNamed("Retry addition")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createCalls()).toHaveLength(2);
    expect(createCalls()[1]?.[2]?.body).toEqual(firstBody);
    expect(apiMock.mock.calls.filter(([path]) => String(path).endsWith(`/crm/contacts/${canonicalContactId}`))).toHaveLength(1);
    expect(apiMock.mock.calls.filter(([path]) => String(path).endsWith(`/crm/contacts/${latestContactId}`))).toHaveLength(1);
    expect(pipelineReads).toBe(4);
    expect(container.querySelectorAll(".crm-board-card")).toHaveLength(1);
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("Katherine Johnson");
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("katherine@example.com");
    expect(container.querySelector(".crm-board-card")?.textContent).not.toContain("Grace Hopper");
    expect(container.querySelector(".crm-board-card")?.textContent).not.toContain("Unknown contact");
    expect(container.querySelector('dialog[aria-label="Add a prospect"]')).toBeNull();
    expect(toastMock).toHaveBeenCalledTimes(2);
    expect(toastMock).toHaveBeenLastCalledWith("Added to the pipeline");
    expect(toastMock.mock.calls.filter(([message]) => message === "Added to the pipeline")).toHaveLength(1);
  });

  it("keeps a confirmed merged replay locked until its canonical contact refresh succeeds", async () => {
    let pipelineAttempts = 0;
    let pipelineReads = 0;
    let contactRefreshAttempts = 0;
    let pipelineId = "";
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      if (path.endsWith(`/crm/contacts/${canonicalContactId}`)) {
        contactRefreshAttempts += 1;
        if (contactRefreshAttempts === 1) throw new TypeError("canonical contact response lost");
        return organizationContactHistoryDtoSchema.parse({ contact: canonicalContact, tags: [], events: [], notes: [], activity: [] });
      }
      if (init?.body) {
        pipelineAttempts += 1;
        pipelineId = String(init.body.id);
        if (pipelineAttempts === 1) throw new TypeError("creation response lost");
      } else {
        pipelineReads += 1;
      }
      const entry = crmPipelineEntryDtoSchema.parse({
        id: pipelineId,
        organizationContactId: canonicalContactId,
        targetEventId: null,
        stage: "open",
        notes: null,
        createdAt: "2026-08-13T18:05:00.000Z",
        updatedAt: "2026-08-13T18:06:00.000Z",
      });
      return init?.body ? entry : [entry];
    });
    await renderBoard();
    await pickContact();
    await act(async () => {
      buttonNamed("Add to pipeline")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      buttonNamed("Retry addition")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(buttonNamed("Retry contact refresh")).toBeDefined();
    expect(buttonNamed("Close and check pipeline")).toBeDefined();
    expect(container.querySelector<HTMLFieldSetElement>(".modal-body fieldset")?.disabled).toBe(true);
    expect(container.querySelectorAll(".crm-board-card")).toHaveLength(0);
    expect(container.textContent).toContain("The prospect was added, but we could not load its current contact after a merge");

    await act(async () => {
      buttonNamed("Retry contact refresh")?.click();
      await Promise.resolve();
    });

    expect(pipelineAttempts).toBe(2);
    expect(pipelineReads).toBe(3);
    expect(contactRefreshAttempts).toBe(2);
    expect(container.querySelectorAll(".crm-board-card")).toHaveLength(1);
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("Grace Hopper");
    expect(container.querySelector('dialog[aria-label="Add a prospect"]')).toBeNull();
    expect(toastMock.mock.calls.filter(([message]) => message === "Added to the pipeline")).toHaveLength(1);
  });

  it("offers only close-and-check when a confirmed replay's canonical contact is gone", async () => {
    let pipelineId = "";
    let pipelineReads = 0;
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      if (path.endsWith(`/crm/contacts/${canonicalContactId}`)) throw new AppError("NOT_FOUND", "Contact not found");
      if (!init?.body) {
        pipelineReads += 1;
        if (pipelineReads > 1) return [];
      } else {
        pipelineId = String(init.body.id);
      }
      const entry = crmPipelineEntryDtoSchema.parse({
        id: pipelineId,
        organizationContactId: canonicalContactId,
        targetEventId: null,
        stage: "open",
        notes: null,
        createdAt: "2026-08-13T18:05:00.000Z",
        updatedAt: "2026-08-13T18:06:00.000Z",
      });
      return init?.body ? entry : [entry];
    });
    await renderBoard();
    await pickContact();
    await act(async () => {
      buttonNamed("Add to pipeline")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("The prospect was added, but its current contact is no longer available");
    expect(buttonNamed("Close and check pipeline")).toBeDefined();
    expect(buttonNamed("Retry contact refresh")).toBeUndefined();
    expect(buttonNamed("Add to pipeline")).toBeUndefined();
    expect(container.querySelector<HTMLFieldSetElement>(".modal-body fieldset")?.disabled).toBe(true);
    expect(container.querySelectorAll(".crm-board-card")).toHaveLength(0);

    await act(async () => {
      buttonNamed("Close and check pipeline")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('dialog[aria-label="Add a prospect"]')).toBeNull();
    expect(buttonNamed("Add prospect")?.disabled).toBe(false);
  });

  it("drains an in-flight stage move before close-and-check reads or applies authority", async () => {
    const existingEntry = crmPipelineEntryDtoSchema.parse({
      id: "c8000000-0000-4000-8000-000000000006",
      organizationContactId: contactId,
      targetEventId: null,
      stage: "open",
      notes: "Existing prospect",
      createdAt: "2026-08-13T17:00:00.000Z",
      updatedAt: "2026-08-13T17:00:00.000Z",
    });
    const movedEntry = { ...existingEntry, stage: "won" as const, updatedAt: "2026-08-13T19:00:00.000Z" };
    const transition = deferred<CrmPipelineEntryDTO>();
    const authority = deferred<CrmPipelineEntryDTO[]>();
    let pipelineReads = 0;
    let transitionCalls = 0;
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      if (path.endsWith(`/crm/contacts/${contactId}`)) {
        return organizationContactHistoryDtoSchema.parse({ contact, tags: [], events: [], notes: [], activity: [] });
      }
      if (path.endsWith("/crm/pipeline") && init?.body) throw new AppError("INTERNAL", "Unexpected API response (500)");
      if (path.endsWith("/crm/pipeline")) {
        pipelineReads += 1;
        if (pipelineReads === 1) return authority.promise;
        return [movedEntry];
      }
      if (path.endsWith(`/crm/pipeline/${existingEntry.id}/transition`)) {
        transitionCalls += 1;
        return transition.promise;
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderBoard([existingEntry], {
      [contactId]: { id: contactId, name: "Ada Speaker", email: contact.email, company: contact.company },
    });
    const stage = container.querySelector<HTMLSelectElement>('select[aria-label="Move Ada Speaker to a different stage"]');
    if (!stage) throw new Error("Expected the existing prospect stage control");
    await changeValue(stage, "won");
    expect(transitionCalls).toBe(1);
    expect(stage.value).toBe("won");

    await pickContact();
    await act(async () => {
      buttonNamed("Add to pipeline")?.click();
      await Promise.resolve();
    });
    await act(async () => buttonNamed("Close and check pipeline")?.click());

    expect(container.querySelector('dialog[aria-label="Add a prospect"]')).toBeNull();
    expect(container.textContent).toContain("Refreshing the pipeline");
    expect(buttonNamed("Add prospect")?.disabled).toBe(true);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Move Ada Speaker to a different stage"]')?.disabled).toBe(true);
    expect(pipelineReads).toBe(0);

    await act(async () => {
      transition.resolve(movedEntry);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pipelineReads).toBe(1);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Move Ada Speaker to a different stage"]')?.value).toBe("won");
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Move Ada Speaker to a different stage"]')?.disabled).toBe(true);
    await act(async () => {
      authority.resolve([movedEntry]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pipelineReads).toBe(2);
    expect(buttonNamed("Add prospect")?.disabled).toBe(false);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Move Ada Speaker to a different stage"]')?.disabled).toBe(false);
    expect(transitionCalls).toBe(1);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Move Ada Speaker to a different stage"]')?.value).toBe("won");
  });

  it("accepts unchanged authority rows returned in the opposite order", async () => {
    const tiedUpdatedAt = "2026-08-13T19:00:00.000Z";
    const firstEntry = crmPipelineEntryDtoSchema.parse({
      id: "c8000000-0000-4000-8000-000000000008",
      organizationContactId: contactId,
      targetEventId: null,
      stage: "open",
      notes: "First tied prospect",
      createdAt: "2026-08-13T17:00:00.000Z",
      updatedAt: tiedUpdatedAt,
    });
    const secondEntry = crmPipelineEntryDtoSchema.parse({
      id: "c8000000-0000-4000-8000-000000000009",
      organizationContactId: contactId,
      targetEventId: null,
      stage: "won",
      notes: "Second tied prospect",
      createdAt: "2026-08-13T17:00:00.000Z",
      updatedAt: tiedUpdatedAt,
    });
    let pipelineReads = 0;
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      if (path.endsWith(`/crm/contacts/${contactId}`)) {
        return organizationContactHistoryDtoSchema.parse({ contact, tags: [], events: [], notes: [], activity: [] });
      }
      if (path.endsWith("/crm/pipeline") && init?.body) throw new AppError("INTERNAL", "Unexpected API response (500)");
      if (path.endsWith("/crm/pipeline")) {
        pipelineReads += 1;
        return pipelineReads === 1 ? [firstEntry, secondEntry] : [secondEntry, firstEntry];
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderBoard();
    await pickContact();
    await act(async () => {
      buttonNamed("Add to pipeline")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      buttonNamed("Close and check pipeline")?.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pipelineReads).toBe(2);
    expect(buttonNamed("Add prospect")?.disabled).toBe(false);
    expect(container.querySelectorAll(".crm-board-card")).toHaveLength(2);
    expect(container.textContent).toContain("First tied prospect");
    expect(container.textContent).toContain("Second tied prospect");
    expect(container.textContent).not.toContain("The pipeline kept changing while it was refreshed");
  });

  it("continues the authority barrier after an in-flight stage move rejects", async () => {
    const existingEntry = crmPipelineEntryDtoSchema.parse({
      id: "c8000000-0000-4000-8000-000000000007",
      organizationContactId: contactId,
      targetEventId: null,
      stage: "open",
      notes: "Rejected move prospect",
      createdAt: "2026-08-13T17:00:00.000Z",
      updatedAt: "2026-08-13T17:00:00.000Z",
    });
    const transition = deferred<CrmPipelineEntryDTO>();
    let pipelineReads = 0;
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      if (path.endsWith(`/crm/contacts/${contactId}`)) {
        return organizationContactHistoryDtoSchema.parse({ contact, tags: [], events: [], notes: [], activity: [] });
      }
      if (path.endsWith("/crm/pipeline") && init?.body) throw new AppError("INTERNAL", "Unexpected API response (500)");
      if (path.endsWith("/crm/pipeline")) {
        pipelineReads += 1;
        return [existingEntry];
      }
      if (path.endsWith(`/crm/pipeline/${existingEntry.id}/transition`)) return transition.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderBoard([existingEntry], {
      [contactId]: { id: contactId, name: "Ada Speaker", email: contact.email, company: contact.company },
    });
    const stage = container.querySelector<HTMLSelectElement>('select[aria-label="Move Ada Speaker to a different stage"]');
    if (!stage) throw new Error("Expected the existing prospect stage control");
    await changeValue(stage, "won");
    await pickContact();
    await act(async () => {
      buttonNamed("Add to pipeline")?.click();
      await Promise.resolve();
    });
    await act(async () => buttonNamed("Close and check pipeline")?.click());

    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Move Ada Speaker to a different stage"]')?.disabled).toBe(true);
    expect(pipelineReads).toBe(0);
    await act(async () => {
      transition.reject(new AppError("CONFLICT", "This pipeline entry changed under you"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pipelineReads).toBe(2);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Move Ada Speaker to a different stage"]')?.disabled).toBe(false);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Move Ada Speaker to a different stage"]')?.value).toBe("open");
    expect(buttonNamed("Add prospect")?.disabled).toBe(false);
    expect(toastMock).toHaveBeenCalledWith("This pipeline entry changed under you");
  });

  it("keeps a definitive conflict editable for a new safe attempt", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      throw new AppError("CONFLICT", "That pipeline creation request is already in use");
    });
    await renderBoard();
    await pickContact();
    await act(async () => {
      buttonNamed("Add to pipeline")?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("That pipeline creation request is already in use");
    expect(buttonNamed("Add to pipeline")).toBeDefined();
    expect(buttonNamed("Retry addition")).toBeUndefined();
    expect(container.querySelector<HTMLFieldSetElement>(".modal-body fieldset")?.disabled).toBe(false);
  });
});
