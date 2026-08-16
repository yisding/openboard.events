/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportSpeakersCsvResult } from "@/shared/contracts";
import { SpeakerImportDialog } from "./speaker-import-dialog";

const harness = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn(), csv: { text: "" } }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock("@/shared/ui/app/file-upload", () => ({
  LocalFilePicker: ({ onPick }: { onPick: (file: File) => void }) => (
    <button type="button" onClick={() => onPick(new File([harness.csv.text], "speakers.csv", { type: "text/csv" }))}>
      Choose a CSV file
    </button>
  ),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const CSV = "email,first\r\nada@example.com,Ada\r\nnot-an-email,Grace\r\n";

const rejectedPreview: ImportSpeakersCsvResult = {
  rows: [
    { rowNumber: 2, email: "ada@example.com", status: "ok", changedFields: ["firstName"], error: null, contactId: null },
    { rowNumber: 3, email: null, status: "error", changedFields: [], error: 'Invalid email "not-an-email"', contactId: null },
  ],
  valid: 1,
  invalid: 1,
  committed: 0,
};

const cleanPreview: ImportSpeakersCsvResult = {
  rows: [
    { rowNumber: 2, email: "ada@example.com", status: "ok", changedFields: ["firstName"], error: null, contactId: null },
    { rowNumber: 3, email: "grace@example.com", status: "ok", changedFields: ["firstName"], error: null, contactId: null },
  ],
  valid: 2,
  invalid: 0,
  committed: 0,
};

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}. Present: ${[...document.querySelectorAll("button")].map((node) => node.textContent).join(" | ")}`);
  return match;
}

function input(label: string): HTMLInputElement {
  const match = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!match) throw new Error(`Missing input: ${label}`);
  return match;
}

async function flush() {
  // Three macrotasks: the dialog reads the picked file through a `FileReader`,
  // whose `onload` lands a tick or two after the click.
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1)));
  }
}

async function type(field: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function sentBody(call: unknown[]): { csvText: string; mode: string } {
  return JSON.parse(String((call[1] as RequestInit).body)) as { csvText: string; mode: string };
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

/** Upload → map → preview, landing on a preview that rejected row 3. */
async function reachRejectedPreview() {
  await act(async () => root.render(<SpeakerImportDialog eventId="e0000000-0000-4000-8000-000000000001" open onClose={() => undefined} />));
  await act(async () => button("Choose a CSV file").click());
  await flush();
  fetchMock.mockResolvedValueOnce(jsonResponse(rejectedPreview));
  await act(async () => button("Preview").click());
  await flush();
}

beforeEach(() => {
  harness.csv.text = CSV;
  harness.refresh.mockReset();
  harness.toast.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("correcting a rejected CSV row in the preview", () => {
  it("re-validates the fix through the same import path, carrying it into the file the commit will use", async () => {
    await reachRejectedPreview();

    expect(button("Import 1 speaker")).toBeTruthy();
    await type(input("Corrected email for row 3"), "grace@example.com");

    fetchMock.mockResolvedValueOnce(jsonResponse(cleanPreview));
    await act(async () => button("Re-check 1 row").click());
    await flush();

    const recheck = sentBody(fetchMock.mock.calls[1] as unknown[]);
    expect(recheck.mode).toBe("preview");
    expect(recheck.csvText).toContain("grace@example.com");
    expect(recheck.csvText).not.toContain("not-an-email");

    // The corrected row is now importable, and the commit sends the same
    // corrected file rather than the one the organizer uploaded.
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...cleanPreview, committed: 2 }));
    await act(async () => button("Import 2 speakers").click());
    await flush();

    const commit = sentBody(fetchMock.mock.calls[2] as unknown[]);
    expect(commit.mode).toBe("commit");
    expect(commit.csvText).toContain("grace@example.com");
  });

  it("keeps the valid rows importable while a row is still rejected", async () => {
    await reachRejectedPreview();

    expect(document.body.textContent).toContain("1 row ready to import · 1 to skip");
    expect(document.body.textContent).toContain("never holds up the rest");
    expect(button("Download errors (1)")).toBeTruthy();

    fetchMock.mockResolvedValueOnce(jsonResponse({ ...rejectedPreview, committed: 1 }));
    await act(async () => button("Import 1 speaker").click());
    await flush();

    expect(sentBody(fetchMock.mock.calls[1] as unknown[]).mode).toBe("commit");
    expect(harness.toast).toHaveBeenCalledWith("1 speaker imported");
  });

  it("offers no correction box for a row that already passed", async () => {
    await reachRejectedPreview();

    expect(document.querySelector('input[aria-label="Corrected email for row 2"]')).toBeNull();
  });

  it("drops a typed correction when a different file is uploaded", async () => {
    await reachRejectedPreview();
    await type(input("Corrected email for row 3"), "grace@example.com");
    expect(button("Re-check 1 row")).toBeTruthy();

    // Back out to the upload step and pick a different file. The row-3
    // correction belonged to the first file and must not survive the swap.
    await act(async () => button("Back").click()); // preview -> map
    await act(async () => button("Back").click()); // map -> upload
    harness.csv.text = "email,first\r\nzoe@example.com,Zoe\r\ngrace@example.com,Grace\r\n";
    await act(async () => button("Choose a CSV file").click());
    await flush();

    fetchMock.mockResolvedValueOnce(jsonResponse(cleanPreview));
    await act(async () => button("Preview").click());
    await flush();

    // The footer offers a plain import, not a re-check of a stale fix, so no
    // correction can be silently written into the new file's row 3.
    expect(button("Import 2 speakers")).toBeTruthy();
    expect([...document.querySelectorAll("button")].some((node) => node.textContent?.includes("Re-check"))).toBe(false);
  });

  it("keeps the typed fix when the re-check request fails", async () => {
    await reachRejectedPreview();
    await type(input("Corrected email for row 3"), "grace@example.com");

    fetchMock.mockRejectedValueOnce(new Error("network"));
    await act(async () => button("Re-check 1 row").click());
    await flush();

    // A failed re-check leaves the fix in place (so it isn't lost) and does not
    // fall back to importing the corrected-but-unpreviewed CSV: the footer still
    // shows the re-check, not an import.
    expect(button("Re-check 1 row")).toBeTruthy();
    expect(input("Corrected email for row 3").value).toBe("grace@example.com");
  });
});
