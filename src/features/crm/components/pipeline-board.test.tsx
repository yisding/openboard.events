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
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { PipelineBoard } from "./pipeline-board";

const apiMock = vi.hoisted(() => vi.fn());
const navigationMock = vi.hoisted(() => ({ refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("next/navigation", () => ({ useRouter: () => navigationMock }));
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

async function renderBoard() {
  await act(async () => {
    root.render(<PipelineBoard organizationId={organizationId} initialEntries={[]} contactsById={{}} events={events} />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  apiMock.mockReset();
  navigationMock.refresh.mockReset();
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
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      pipelineAttempts += 1;
      if (pipelineAttempts === 1) throw new TypeError("connection lost after commit");
      return crmPipelineEntryDtoSchema.parse({
        id: init?.body?.id,
        organizationContactId: contactId,
        targetEventId: eventId,
        stage: "open",
        notes: "Follow up after the keynote",
        createdAt: "2026-08-13T18:05:00.000Z",
        updatedAt: "2026-08-13T18:05:00.000Z",
      });
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

    const createCalls = () => apiMock.mock.calls.filter(([path]) => String(path).endsWith("/crm/pipeline"));
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
    expect(container.querySelectorAll(".crm-board-card")).toHaveLength(1);
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("Ada Speaker");
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("Follow up after the keynote");
    expect(container.querySelector('dialog[aria-label="Add a prospect"]')).toBeNull();
    expect(toastMock).toHaveBeenCalledWith("Added to the pipeline");
  });

  it("loads the canonical contact before materializing a merged replay", async () => {
    let pipelineAttempts = 0;
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      if (path.endsWith(`/crm/contacts/${canonicalContactId}`)) {
        return organizationContactHistoryDtoSchema.parse({
          contact: canonicalContact,
          tags: [],
          events: [],
          notes: [],
          activity: [],
        });
      }
      pipelineAttempts += 1;
      if (pipelineAttempts === 1) throw new TypeError("connection lost after commit");
      return crmPipelineEntryDtoSchema.parse({
        id: init?.body?.id,
        organizationContactId: canonicalContactId,
        targetEventId: eventId,
        stage: "open",
        notes: "Merged while the response was lost",
        createdAt: "2026-08-13T18:05:00.000Z",
        updatedAt: "2026-08-13T18:06:00.000Z",
      });
    });
    await renderBoard();
    await pickContact();

    await act(async () => {
      buttonNamed("Add to pipeline")?.click();
      await Promise.resolve();
    });
    const createCalls = () => apiMock.mock.calls.filter(([path]) => String(path).endsWith("/crm/pipeline"));
    const firstBody = createCalls()[0]?.[2]?.body;

    await act(async () => {
      buttonNamed("Retry addition")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createCalls()).toHaveLength(2);
    expect(createCalls()[1]?.[2]?.body).toEqual(firstBody);
    expect(apiMock.mock.calls.filter(([path]) => String(path).endsWith(`/crm/contacts/${canonicalContactId}`))).toHaveLength(1);
    expect(container.querySelectorAll(".crm-board-card")).toHaveLength(1);
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("Grace Hopper");
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("grace@example.com");
    expect(container.querySelector(".crm-board-card")?.textContent).not.toContain("Unknown contact");
    expect(container.querySelector('dialog[aria-label="Add a prospect"]')).toBeNull();
    expect(toastMock).toHaveBeenCalledTimes(2);
    expect(toastMock).toHaveBeenLastCalledWith("Added to the pipeline");
    expect(toastMock.mock.calls.filter(([message]) => message === "Added to the pipeline")).toHaveLength(1);
    expect(navigationMock.refresh).not.toHaveBeenCalled();
  });

  it("keeps a confirmed merged replay locked until its canonical contact refresh succeeds", async () => {
    let pipelineAttempts = 0;
    let contactRefreshAttempts = 0;
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      if (path.endsWith(`/crm/contacts/${canonicalContactId}`)) {
        contactRefreshAttempts += 1;
        if (contactRefreshAttempts === 1) throw new TypeError("canonical contact response lost");
        return organizationContactHistoryDtoSchema.parse({ contact: canonicalContact, tags: [], events: [], notes: [], activity: [] });
      }
      pipelineAttempts += 1;
      if (pipelineAttempts === 1) throw new TypeError("creation response lost");
      return crmPipelineEntryDtoSchema.parse({
        id: init?.body?.id,
        organizationContactId: canonicalContactId,
        targetEventId: null,
        stage: "open",
        notes: null,
        createdAt: "2026-08-13T18:05:00.000Z",
        updatedAt: "2026-08-13T18:06:00.000Z",
      });
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
    expect(contactRefreshAttempts).toBe(2);
    expect(container.querySelectorAll(".crm-board-card")).toHaveLength(1);
    expect(container.querySelector(".crm-board-card")?.textContent).toContain("Grace Hopper");
    expect(container.querySelector('dialog[aria-label="Add a prospect"]')).toBeNull();
    expect(toastMock.mock.calls.filter(([message]) => message === "Added to the pipeline")).toHaveLength(1);
    expect(navigationMock.refresh).not.toHaveBeenCalled();
  });

  it("offers only close-and-check when a confirmed replay's canonical contact is gone", async () => {
    apiMock.mockImplementation(async (path: string, _schema: unknown, init?: { body?: Record<string, unknown> }) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      if (path.endsWith(`/crm/contacts/${canonicalContactId}`)) throw new AppError("NOT_FOUND", "Contact not found");
      return crmPipelineEntryDtoSchema.parse({
        id: init?.body?.id,
        organizationContactId: canonicalContactId,
        targetEventId: null,
        stage: "open",
        notes: null,
        createdAt: "2026-08-13T18:05:00.000Z",
        updatedAt: "2026-08-13T18:06:00.000Z",
      });
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

    await act(async () => buttonNamed("Close and check pipeline")?.click());
    expect(navigationMock.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('dialog[aria-label="Add a prospect"]')).toBeNull();
  });

  it("closes an ambiguous attempt to refresh server authority without inventing a card", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.includes("crm/contacts?")) return { rows: [contact], total: 1 };
      throw new AppError("INTERNAL", "Unexpected API response (500)");
    });
    await renderBoard();
    await pickContact();
    await act(async () => {
      buttonNamed("Add to pipeline")?.click();
      await Promise.resolve();
    });
    await act(async () => buttonNamed("Close and check pipeline")?.click());

    expect(navigationMock.refresh).toHaveBeenCalledOnce();
    expect(container.querySelectorAll(".crm-board-card")).toHaveLength(0);
    expect(container.querySelector('dialog[aria-label="Add a prospect"]')).toBeNull();
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
    expect(navigationMock.refresh).not.toHaveBeenCalled();
  });
});
