/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submissionDetailDtoSchema, type SubmissionDetailDTO } from "@/shared/contracts";
import { SubmissionDrawer } from "./submission-drawer";
import { settle } from "@tests/support/react";

const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({ useUnsavedWorkGuard: vi.fn() }));
vi.mock("./submission-answers", () => ({ SubmissionAnswers: () => null }));
vi.mock("../evaluation/components/submission-review-history", () => ({ SubmissionReviewHistory: () => null }));
vi.mock("./submission-decision-history", () => ({ SubmissionDecisionHistory: () => null }));
vi.mock("./abstract-fields", () => ({
  AbstractFields: ({
    values,
    onChange,
    disabled,
  }: {
    values: { title: string; [key: string]: unknown };
    onChange: (values: { title: string; [key: string]: unknown }) => void;
    disabled: boolean;
  }) => React.createElement("input", {
    "aria-label": "Session title",
    disabled,
    value: values.title,
    onInput: (event: React.FormEvent<HTMLInputElement>) => onChange({ ...values, title: event.currentTarget.value }),
  }),
  toPatch: (
    values: { title: string },
    original: { title: string },
  ) => values.title === original.title ? {} : { title: values.title.trim() },
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const EVENT_ID = "c4100000-0000-4000-8000-000000000001";
const SUBMISSION_ID = "c4100000-0000-4000-8000-000000000002";
const vocabulary = { tracks: [], formats: [], tags: [] };

function detail(title = "Original title", rowVersion = 1): SubmissionDetailDTO {
  return submissionDetailDtoSchema.parse({
    submissionId: SUBMISSION_ID,
    code: 42,
    status: "pending",
    source: "cfp",
    formId: null,
    formName: null,
    title,
    descriptionPlain: null,
    submitterEmail: null,
    submitterName: null,
    speakers: [],
    trackId: null,
    trackName: null,
    trackColor: null,
    tags: [],
    rating: null,
    nScores: 0,
    notifiedAt: null,
    submittedAt: null,
    createdAt: "2026-08-13T12:00:00.000Z",
    formatName: null,
    language: null,
    level: null,
    capacity: null,
    clientSessionId: null,
    rowVersion,
    descriptionHtml: null,
    startsAt: null,
    endsAt: null,
    participants: [],
    answerPanel: { formVersion: null, snapshot: null, answers: [], participants: [], files: {} },
  });
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;


async function mount(canEdit = false) {
  await act(async () => {
    root.render(
      <SubmissionDrawer
        eventId={EVENT_ID}
        submissionId={SUBMISSION_ID}
        timezone="America/Los_Angeles"
        vocabulary={vocabulary}
        canEdit={canEdit}
        onClose={vi.fn()}
      />,
    );
  });
  await settle();
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function editTitle(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Session title"]');
  if (!input) throw new Error("Session title input was not rendered");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input;
}

beforeEach(() => {
  routerMock.refresh.mockReset();
  toastMock.mockReset();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  }
  if (typeof HTMLDialogElement.prototype.close !== "function") {
    HTMLDialogElement.prototype.close = function close() { this.open = false; };
  }
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("submission detail drawer recovery", () => {
  it("recovers an initial transport failure in place", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await mount();

    expect(container.textContent).toContain("Check your connection and try again");
    expect(buttonNamed("Retry")).toBeDefined();

    fetchMock.mockResolvedValueOnce(Response.json({ data: detail() }));
    await act(async () => buttonNamed("Retry")?.click());
    await settle();

    expect(container.querySelector(".drawer-hero h2")?.textContent).toBe("Original title");
    expect(buttonNamed("Retry")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, "UNAUTHORIZED", "Sign in required"],
    [403, "FORBIDDEN", "You do not have access to this event"],
    [404, "NOT_FOUND", "Submission not found"],
  ])("keeps %s %s authoritative instead of presenting connection recovery", async (status, code, message) => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code, message } }, { status }));
    await mount();

    expect(container.textContent).toContain(message);
    expect(container.textContent).not.toContain("Check your connection");
    expect(buttonNamed("Retry")).toBeUndefined();
  });

  it("keeps a transient response failure retryable without calling it a connection failure", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "INTERNAL", message: "Unexpected server error" } }, { status: 503 }));
    await mount();

    expect(container.textContent).toContain("Unexpected server error");
    expect(container.textContent).not.toContain("Check your connection");
    expect(buttonNamed("Retry")).toBeDefined();
  });

  it("keeps stale fields locked until the rejected row version is replaced", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: detail() }))
      .mockResolvedValueOnce(Response.json({ error: { code: "STALE_WRITE", message: "Submission changed" } }, { status: 409 }))
      .mockRejectedValueOnce(new TypeError("connection lost during reload"))
      .mockResolvedValueOnce(Response.json({ data: detail("Server title", 2) }))
      .mockResolvedValueOnce(Response.json({ data: { rowVersion: 3 } }));
    await mount(true);

    await act(async () => { editTitle("My interrupted edit"); });
    expect(buttonNamed("Save changes")?.disabled).toBe(false);
    await act(async () => buttonNamed("Save changes")?.click());
    await settle();

    expect(container.textContent).toContain("The latest version couldn’t be loaded. Check your connection and retry.");
    expect(buttonNamed("Retry loading latest")).toBeDefined();
    expect(buttonNamed("Latest version required")?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Session title"]')?.disabled).toBe(true);

    await act(async () => buttonNamed("Retry loading latest")?.click());
    await settle();

    const reloaded = container.querySelector<HTMLInputElement>('input[aria-label="Session title"]');
    expect(reloaded?.value).toBe("Server title");
    expect(reloaded?.disabled).toBe(false);
    expect(container.textContent).toContain("Latest version loaded. Re-apply your edit, then save.");

    await act(async () => { editTitle("Re-applied edit"); });
    await act(async () => buttonNamed("Save changes")?.click());
    await settle();

    const finalRequest = fetchMock.mock.calls[4]?.[1];
    expect(JSON.parse(String(finalRequest?.body))).toEqual({
      expectedRowVersion: 2,
      patch: { title: "Re-applied edit" },
    });
    expect(toastMock).toHaveBeenCalledWith("Submission saved");
  });
});
