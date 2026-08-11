import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ResourcePageRow } from "./resources/server/queries";
import {
  completeResourcePageDelete,
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
    id: "page-1",
    title: "Speaker guide",
    slug: "speaker-guide",
    summary: "Everything speakers need",
    published: true,
    sortOrder: 0,
    updatedAt: "2026-08-11T00:00:00.000Z",
  };

  it("rejects failed or malformed resource refreshes instead of treating them as success", async () => {
    const failed = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Unavailable" } }), { status: 503 }));
    const missing = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const succeeds = vi.fn(async () => new Response(JSON.stringify({ data: [page] }), { status: 200 }));

    await expect(fetchResourcePages("event-1", failed)).rejects.toThrow("Unavailable");
    await expect(fetchResourcePages("event-1", missing)).rejects.toThrow("Could not refresh resource pages");
    await expect(fetchResourcePages("event-1", succeeds)).resolves.toEqual([page]);
  });

  it("returns a false result for HTTP and transport delete failures and true only on success", async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Page is locked" } }), { status: 409 }));
    const offline = vi.fn(async () => { throw new Error("offline"); });
    const succeeds = vi.fn(async () => new Response(null, { status: 204 }));

    await expect(deleteResourcePage("event-1", page, refused)).resolves.toEqual({ ok: false, message: "Page is locked" });
    await expect(deleteResourcePage("event-1", page, offline)).resolves.toEqual({ ok: false, message: "That page could not be deleted" });
    await expect(deleteResourcePage("event-1", page, succeeds)).resolves.toEqual({ ok: true });
    expect(succeeds).toHaveBeenCalledWith("/api/internal/resources/event-1/page-1", { method: "DELETE" });
  });

  it("keeps the row and confirmation on delete failure, then removes, refreshes, and closes on success", async () => {
    const effects = {
      onError: vi.fn(),
      onDeleted: vi.fn(),
      removeRow: vi.fn(),
      refresh: vi.fn(async () => undefined),
      onRefreshError: vi.fn(),
      closeConfirmation: vi.fn(),
    };
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Page is locked" } }), { status: 409 }));
    await expect(completeResourcePageDelete("event-1", page, effects, refused)).resolves.toBe(false);
    expect(effects.onError).toHaveBeenCalledWith("Page is locked");
    expect(effects.removeRow).not.toHaveBeenCalled();
    expect(effects.refresh).not.toHaveBeenCalled();
    expect(effects.closeConfirmation).not.toHaveBeenCalled();

    const succeeds = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(completeResourcePageDelete("event-1", page, effects, succeeds)).resolves.toBe(true);
    expect(effects.onDeleted).toHaveBeenCalledOnce();
    expect(effects.removeRow).toHaveBeenCalledOnce();
    expect(effects.refresh).toHaveBeenCalledOnce();
    expect(effects.closeConfirmation).toHaveBeenCalledOnce();
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
