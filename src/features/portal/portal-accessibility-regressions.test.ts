import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ResourcePageRow } from "./resources/server/queries";
import {
  completeResourcePageReorder,
  deleteResourcePage,
  fetchResourcePages,
  persistResourcePageOrder,
  restoreResourcePageOrder,
} from "./resources/components/resource-pages-admin-view";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("portal accessibility regressions", () => {
  const page: ResourcePageRow = {
    id: "e7000000-0000-4000-8000-000000000001",
    title: "Speaker guide",
    slug: "speaker-guide",
    summary: "Everything speakers need",
    published: true,
    sortOrder: 0,
    updatedAt: "2026-08-11T00:00:00.000Z",
  };

  it("rejects failed or malformed resource refreshes instead of treating them as success", async () => {
    const failed = vi.fn(async () => new Response(JSON.stringify({ error: { code: "INTERNAL", message: "Unavailable" } }), { status: 503 }));
    const missing = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const succeeds = vi.fn(async () => new Response(JSON.stringify({ data: [page] }), { status: 200 }));

    await expect(fetchResourcePages("event-1", failed)).rejects.toThrow("Unavailable");
    await expect(fetchResourcePages("event-1", missing)).rejects.toThrow("Could not refresh resource pages");
    await expect(fetchResourcePages("event-1", succeeds)).resolves.toEqual([page]);
  });

  it("separates definitive resource delete refusals from ambiguous transport and malformed outcomes", async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { code: "CONFLICT", message: "Page is locked" } }), { status: 409 }));
    const offline = vi.fn(async () => { throw new Error("offline"); });
    const malformed = vi.fn(async () => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    const succeeds = vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));

    await expect(deleteResourcePage("event-1", page, refused)).resolves.toEqual({ kind: "definitive", message: "Page is locked" });
    await expect(deleteResourcePage("event-1", page, offline)).resolves.toEqual({ kind: "ambiguous" });
    await expect(deleteResourcePage("event-1", page, malformed)).resolves.toEqual({ kind: "ambiguous" });
    await expect(deleteResourcePage("event-1", page, succeeds)).resolves.toEqual({ kind: "confirmed" });
    expect(succeeds).toHaveBeenCalledWith("/api/internal/resources/event-1/e7000000-0000-4000-8000-000000000001", { method: "DELETE" });
  });

  it("rejects a failed reorder and sends the exact ordered ids on success", async () => {
    const failed = vi.fn(async () => new Response(null, { status: 500 }));
    await expect(persistResourcePageOrder("event-1", ["page-2", "page-1"], failed)).rejects.toThrow("Could not reorder pages");

    const succeeds = vi.fn(async () => new Response(null, { status: 204 }));
    await persistResourcePageOrder("event-1", ["page-2", "page-1"], succeeds);
    expect(succeeds).toHaveBeenCalledWith("/api/internal/resources/event-1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ orderedIds: ["page-2", "page-1"] }),
    }));
  });

  it("handles a non-OK refresh while recovering a failed reorder", async () => {
    const rollback = vi.fn();
    const onError = vi.fn();
    const onRefreshError = vi.fn();
    const refreshRequest = vi.fn(async () => new Response(null, { status: 503 }));
    const effects = {
      rollback,
      onError,
      refresh: async () => { await fetchResourcePages("event-1", refreshRequest); },
      onRefreshError,
    };
    const reorderRequest = vi.fn(async () => new Response(null, { status: 500 }));

    await expect(completeResourcePageReorder("event-1", ["page-2", "page-1"], effects, reorderRequest)).resolves.toBe(false);
    expect(rollback).toHaveBeenCalledOnce();
    expect(rollback.mock.invocationCallOrder[0]).toBeLessThan(refreshRequest.mock.invocationCallOrder[0] ?? Infinity);
    expect(onError).toHaveBeenCalledOnce();
    expect(refreshRequest).toHaveBeenCalledOnce();
    expect(onRefreshError).toHaveBeenCalledOnce();
  });

  it("restores resource order without discarding concurrent edits, additions, or deletions", () => {
    const current = [
      { id: "page-3", title: "Edited while reordering" },
      { id: "page-1", title: "First" },
      { id: "page-4", title: "Added while reordering" },
    ];

    const restored = restoreResourcePageOrder(current, ["page-1", "page-2", "page-3"]);

    expect(restored).toEqual([current[1], current[0], current[2]]);
    expect(restored[1]).toBe(current[0]);
  });

  it("focuses server-invalid task and submission fields and clears a corrected field error", () => {
    for (const path of [
      "./task-runtime/components/task-detail.tsx",
      "./submissions-edit/components/edit-submission-form.tsx",
    ]) {
      const form = source(path);
      expect(form).toContain("formPanelRef.current?.querySelector<HTMLElement>('[aria-invalid=\"true\"]')?.focus()");
      expect(form).toContain("function changeAnswer(fieldId: string, value: AnswerValue | undefined)");
      expect(form).toContain("delete next[fieldId]");
      expect(form).toContain("onChange={changeAnswer}");
    }
  });

  it("uses error toast semantics for every portal form-builder mutation failure", () => {
    const builder = source("./form-builder/components/portal-form-builder.tsx");
    for (const message of [
      "The form could not be saved",
      "The field could not be added",
      "The question could not be added",
      "The question could not be saved",
      "The question could not be removed",
      "The question order could not be saved",
    ]) {
      expect(builder).toContain(`: "${message}", { kind: "error" });`);
    }
  });
});
