/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportOrganizationButton } from "./export-organization-button";

const harness = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: harness.toast }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = "o0000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function flush() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let createUrl: ReturnType<typeof vi.fn>;
let revokeUrl: ReturnType<typeof vi.fn>;
let anchorClick: ReturnType<typeof vi.fn>;
let lastAnchor: HTMLAnchorElement | null;
const urlStatics = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
let originalCreateUrl: unknown;
let originalRevokeUrl: unknown;

beforeEach(() => {
  harness.toast.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  createUrl = vi.fn(() => "blob:mock");
  revokeUrl = vi.fn();
  originalCreateUrl = urlStatics.createObjectURL;
  originalRevokeUrl = urlStatics.revokeObjectURL;
  urlStatics.createObjectURL = createUrl;
  urlStatics.revokeObjectURL = revokeUrl;
  anchorClick = vi.fn();
  lastAnchor = null;
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const element = realCreate(tag);
    if (tag === "a") {
      lastAnchor = element as HTMLAnchorElement;
      (element as HTMLAnchorElement).click = anchorClick;
    }
    return element;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  urlStatics.createObjectURL = originalCreateUrl;
  urlStatics.revokeObjectURL = originalRevokeUrl;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<ExportOrganizationButton organizationId={organizationId} organizationName="Fjord Fest" />));
}

describe("exporting organization data", () => {
  it("calls the export endpoint and downloads the returned bundle as a named JSON file", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { organization: { id: organizationId }, members: [] } }));
    await render();

    await act(async () => button("Export data").click());
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe(`/api/internal/organizations/${organizationId}/export`);
    expect(init?.method ?? "GET").toBe("GET");
    expect(createUrl).toHaveBeenCalledTimes(1);
    const [blob] = createUrl.mock.calls[0] as [Blob];
    expect(await blob.text()).toContain("\"organization\"");
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(lastAnchor?.download).toBe("fjord-fest-export.json");
    expect(harness.toast).toHaveBeenCalledWith("Organization data exported");
  });

  it("surfaces the endpoint's error and downloads nothing when the export fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: "FORBIDDEN", message: "Only owners can export" } }, 403));
    await render();

    await act(async () => button("Export data").click());
    await flush();

    expect(createUrl).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(harness.toast).toHaveBeenCalledWith("Only owners can export", { kind: "error" });
  });
});
