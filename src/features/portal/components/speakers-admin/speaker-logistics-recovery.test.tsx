/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeakerRosterExtras } from "@/features/portal";
import type { LogisticsFieldId } from "@/shared/contracts/ids";
import { SpeakerRosterPanels } from "./speaker-roster-panels";

const harness = vi.hoisted(() => ({
  guard: { active: false, blocking: false },
  refresh: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: (active: boolean, options?: { blocking?: boolean }) => {
    if (options) harness.guard = { active, blocking: options.blocking === true };
  },
}));
vi.mock("@/shared/ui/app/datetime-picker", () => ({ DateTimePicker: () => null }));
vi.mock("@/shared/ui/app/private-file-link", () => ({ PrivateFileLink: () => null }));
vi.mock("@/shared/ui/app/tz-time", () => ({ TzTime: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const fieldId = "00000000-0000-4000-8000-000000000011" as LogisticsFieldId;
const initialExtras: SpeakerRosterExtras = {
  workflowStatus: "new",
  fields: [{ id: fieldId, key: "hotel", label: "Hotel", fieldType: "text", options: [], sortOrder: 0 }],
  values: [{ fieldId, value: "Old hotel" }],
  unavailability: [],
  uploads: [],
};

function extrasWith(value: string): SpeakerRosterExtras {
  return { ...initialExtras, values: [{ fieldId, value }] };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function logisticsInput(container: HTMLElement): HTMLInputElement {
  const section = [...container.querySelectorAll("section")]
    .find((candidate) => candidate.querySelector("h2")?.textContent === "Logistics");
  const input = section?.querySelector<HTMLInputElement>("input");
  if (!input) throw new Error("Missing logistics input");
  return input;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function flush() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function editAndBlur(input: HTMLInputElement, value: string) {
  await act(async () => {
    input.focus();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.blur());
  await flush();
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  harness.guard = { active: false, blocking: false };
  harness.refresh.mockReset();
  harness.toast.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <SpeakerRosterPanels
      eventId="00000000-0000-4000-8000-000000000001"
      contactId="00000000-0000-4000-8000-000000000002"
      timezone="UTC"
      initialExtras={initialExtras}
    />,
  ));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("speaker logistics outcome recovery", () => {
  it.each([
    ["a lost response", () => Promise.reject(new TypeError("network ended"))],
    ["an INTERNAL response", () => Promise.resolve(jsonResponse({ error: { message: "Internal error" } }, 500))],
    ["a malformed response", () => Promise.resolve(new Response("not-json", { status: 200 }))],
  ])("confirms the committed value after %s without sending a second PATCH", async (_label, firstOutcome) => {
    fetchMock.mockImplementationOnce(firstOutcome);
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: extrasWith("New hotel") }));

    await editAndBlur(logisticsInput(container), "New hotel");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.method ?? "GET")).toEqual(["PATCH", "GET"]);
    expect(logisticsInput(container).value).toBe("New hotel");
    expect(logisticsInput(container).disabled).toBe(false);
    expect(harness.guard).toEqual({ active: false, blocking: false });
    expect(harness.toast).toHaveBeenCalledWith("Saved value confirmed");
    expect(harness.toast.mock.calls.flat().join(" ")).not.toContain("restored");
  });

  it("keeps an unknown attempt locked, then offers an exact deliberate retry when authority still has the prior value", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network ended"));
    fetchMock.mockRejectedValueOnce(new TypeError("authority unavailable"));

    await editAndBlur(logisticsInput(container), "New hotel");

    expect(logisticsInput(container).value).toBe("New hotel");
    expect(logisticsInput(container).disabled).toBe(true);
    expect(harness.guard).toEqual({ active: true, blocking: true });
    expect(button(container, "Check saved value")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: initialExtras }));
    await act(async () => button(container, "Check saved value").click());
    await flush();

    expect(logisticsInput(container).value).toBe("New hotel");
    expect(button(container, "Retry save")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: extrasWith("New hotel") }));
    await act(async () => button(container, "Retry save").click());
    await flush();

    const patchCalls = fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "PATCH");
    expect(patchCalls).toHaveLength(2);
    expect(patchCalls[0]?.[1]).toMatchObject({ body: patchCalls[1]?.[1]?.body });
    expect(logisticsInput(container).value).toBe("New hotel");
    expect(logisticsInput(container).disabled).toBe(false);
    expect(harness.guard).toEqual({ active: false, blocking: false });
  });

  it("restores the baseline only after a definitive rejection and does not issue an authority read", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "That value is not allowed" } }, 422));

    await editAndBlur(logisticsInput(container), "Rejected hotel");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logisticsInput(container).value).toBe("Old hotel");
    expect(logisticsInput(container).disabled).toBe(false);
    expect(harness.guard).toEqual({ active: false, blocking: false });
    // A reverted save is a failure: it must announce assertively and stay on
    // screen, not render as a green success that auto-dismisses in 3.2s.
    expect(harness.toast).toHaveBeenCalledWith(
      "That value is not allowed. The previous value was restored.",
      { kind: "error" },
    );
  });

  it("adopts a concurrent third value and requires a deliberate overwrite with the protected attempt", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network ended"));
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: extrasWith("Colleague hotel") }));

    await editAndBlur(logisticsInput(container), "My hotel");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logisticsInput(container).value).toBe("Colleague hotel");
    expect(logisticsInput(container).disabled).toBe(true);
    expect(button(container, "Use my value")).toBeTruthy();
    expect(harness.guard).toEqual({ active: true, blocking: true });

    fetchMock.mockResolvedValueOnce(jsonResponse({ data: extrasWith("My hotel") }));
    await act(async () => button(container, "Use my value").click());
    await flush();

    const patchCalls = fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "PATCH");
    expect(patchCalls).toHaveLength(2);
    expect(JSON.parse(patchCalls[1]?.[1]?.body as string)).toEqual({ logisticsValues: { [fieldId]: "My hotel" } });
    expect(logisticsInput(container).value).toBe("My hotel");
    expect(logisticsInput(container).disabled).toBe(false);
    expect(harness.guard).toEqual({ active: false, blocking: false });
  });
});
