/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema, organizationIdSchema } from "@/shared/contracts";
import { readTourMirror, writeTourMirror } from "@/shared/ui/app/guided-tour/mirror";
import { DemoRibbon } from "./demo-ribbon";

const fetchMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock, push: pushMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("40000000-0000-4000-8000-000000000001");
const organizationId = organizationIdSchema.parse("30000000-0000-4000-8000-000000000001");
const eventName = "AI Engineer World’s Fair (demo)";
const demoPath = `/api/internal/organizations/${organizationId}/demo`;
const tourPath = `/api/internal/events/${eventId}/tour`;

/** The step the player finished on, mirrored by the engine in this browser. */
const finishedMirror = { chapter: "curtain-call", stepId: "curtain.done", status: "complete" } as const;

let container: HTMLDivElement;
let root: Root;
let assign: ReturnType<typeof vi.fn>;

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, json: async () => ({ data }) };
}

const provisionState = (done: boolean) => jsonResponse({
  eventId,
  eventSlug: "ai-engineer-worlds-fair-demo-a1b2c3d4",
  phase: done ? "ready" : "people",
  phaseIndex: done ? 10 : 2,
  phaseCount: 10,
  label: done ? "Your conference is ready." : "Inviting eighteen speakers…",
  done,
});

/** A finished tour, exactly as `GET events/:id/tour` reports one. */
const tourState = jsonResponse({
  eventId, chapter: "curtain-call", stepId: "curtain.done", status: "complete",
  updatedAt: "2026-08-16T19:00:00.000Z",
  armedStepId: null, armedBaseline: null, completed: [], questsDone: [], skipped: [],
  world: {
    formFields: 19, formVersions: 8, submissionsTotal: 24, pendingCount: 1, acceptedCount: 18,
    reviewsByMe: 1, decisionEmailsQueued: 7, sessionsScheduled: 17, conflictCount: 0,
    publishedSessions: 17, embedEnabled: true, templateUpdatedAt: null,
    portalTaskCompletions: 14, resourcePagesPublished: 2, contactsUpdatedAt: null,
  },
});

/** Buttons are matched on their whole trimmed label, icons included. */
function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === name);
}

function openDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>("dialog[open]");
}

async function press(name: string) {
  await act(async () => { button(name)?.click(); });
  // The handlers chain two or three awaited requests before they settle.
  await act(async () => { for (let tick = 0; tick < 12; tick += 1) await Promise.resolve(); });
}

/** React reads the tracked value, so the native setter has to do the writing. */
async function typeConfirmation(value: string) {
  const input = document.querySelector<HTMLInputElement>("dialog[open] input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function bodyOf(call: unknown[] | undefined): unknown {
  const init = call?.[1] as { body?: string } | undefined;
  return init?.body === undefined ? undefined : JSON.parse(init.body);
}

beforeEach(async () => {
  fetchMock.mockReset();
  toastMock.mockReset();
  refreshMock.mockReset();
  pushMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  assign = vi.fn();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => { root = createRoot(container); });
  await act(async () => root.render(
    <DemoRibbon eventId={eventId} eventName={eventName} organizationId={organizationId} />,
  ));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("DemoRibbon confirmations", () => {
  it("opens the reset confirm and rebuilds the world from it", async () => {
    fetchMock.mockResolvedValueOnce(provisionState(false)).mockResolvedValue(provisionState(true));

    await press("Reset");

    // The confirm is a real, open dialog — not a state flag with no UI behind it.
    expect(openDialog()?.textContent).toContain("Rebuild this demo?");
    expect(fetchMock).not.toHaveBeenCalled();

    await press("Reset demo");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(demoPath);
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ mode: "reset" });
    // The first response was not `done`, so the ribbon drives the rest of the
    // phases exactly the way the provisioning screen does.
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ mode: "provision" });
    expect(openDialog()).toBeNull();
  });

  it("opens the delete confirm and holds it shut until the event's name is typed", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: true }));

    await press("Delete");

    expect(openDialog()?.textContent).toContain("Delete this demo event?");
    expect(button("Delete demo event")?.disabled).toBe(true);

    await typeConfirmation(eventName);

    expect(button("Delete demo event")?.disabled).toBe(false);
    await press("Delete demo event");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ confirm: "DELETE" });
    expect(toastMock).toHaveBeenCalledWith(`${eventName} deleted`);
    expect(pushMock).toHaveBeenCalledWith(`/organizations/${organizationId}`);
  });

  it("cancels out of a confirm without touching the API", async () => {
    await press("Reset");
    await press("Cancel");

    expect(openDialog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * The engine trusts its localStorage mirror whenever that mirror is *ahead* of
 * the server cursor. Every one of the ribbon's three lifecycle actions makes
 * that mirror a lie, and a surviving one drags the tour back to the step it
 * names — the curtain call, in practice, whose modal `<dialog>` owns the top
 * layer and leaves this ribbon's own buttons unclickable.
 */
describe("DemoRibbon and the tour's optimistic mirror", () => {
  beforeEach(() => {
    writeTourMirror(eventId, finishedMirror);
    expect(readTourMirror(eventId)).not.toBeNull();
  });

  it("drops the mirror and reloads the shell when the tour is restarted", async () => {
    fetchMock.mockResolvedValue(tourState);

    await press("Restart tour");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(tourPath);
    expect(bodyOf(fetchMock.mock.calls[1])).toMatchObject({
      expectedStepId: "curtain.done", chapter: "cold-open", stepId: "coldopen.hello", status: "active",
    });
    expect(readTourMirror(eventId)).toBeNull();
    // A soft refresh cannot restart the tour: the engine seeds its cursor from
    // the layout's bootstrap once per document load.
    expect(assign).toHaveBeenCalledWith(`/events/${eventId}/dashboard`);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("keeps the mirror when the restart never lands", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { code: "INTERNAL", message: "no" } }) });

    await press("Restart tour");

    expect(readTourMirror(eventId)).toEqual(finishedMirror);
    expect(assign).not.toHaveBeenCalled();
    // As an error, not a success: this one has to stay on screen long enough
    // to be read, because the button it belongs to did nothing.
    expect(toastMock).toHaveBeenCalledWith("Could not restart the tour — try again from the command palette", { kind: "error" });
    // Still offered: a failed restart must not leave the button spinning.
    expect(button("Restart tour")?.disabled).toBe(false);
  });

  it("drops the mirror when the demo is rebuilt", async () => {
    fetchMock.mockResolvedValue(provisionState(true));

    await press("Reset");
    await press("Reset demo");

    expect(readTourMirror(eventId)).toBeNull();
    expect(assign).toHaveBeenCalledWith(`/events/${eventId}/dashboard`);
  });

  it("drops the mirror when the demo is deleted, because the next one reuses its id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: true }));

    await press("Delete");
    await typeConfirmation(eventName);
    await press("Delete demo event");

    expect(readTourMirror(eventId)).toBeNull();
  });
});

/**
 * All three lifecycle actions are destructive and slow, and all three can fail
 * halfway. A failure announced through the default toast is styled as a success
 * and dismissed after 3.2s — so the organizer who looked away sees a rebuilt
 * demo that was never rebuilt, with nothing left on screen to say otherwise.
 * Every failure branch here has to be an error toast, which is the kind that
 * stays put until it is dismissed.
 */
describe("DemoRibbon failures announce themselves as failures", () => {
  const failure = { ok: false, status: 500, json: async () => ({ error: { code: "INTERNAL", message: "no" } }) };

  it("keeps a failed reset on screen and offers the button again", async () => {
    fetchMock.mockResolvedValue(failure);

    await press("Reset");
    await press("Reset demo");

    expect(toastMock).toHaveBeenCalledWith(
      "Reset did not finish — press Reset again to pick up where it stopped", { kind: "error" },
    );
    expect(assign).not.toHaveBeenCalled();
    expect(button("Reset demo")?.disabled).toBe(false);
  });

  it("keeps a failed delete on screen and does not navigate away", async () => {
    fetchMock.mockResolvedValue(failure);

    await press("Delete");
    await typeConfirmation(eventName);
    await press("Delete demo event");

    expect(toastMock).toHaveBeenCalledWith("Could not delete the demo — try again", { kind: "error" });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
