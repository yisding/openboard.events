"use client";

import { useCallback, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, BookOpen, Plus } from "lucide-react";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { DataTable } from "@/shared/ui/app/data-table";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, EmptyState, PageHeader, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { ResourcePageDTO, ResourcePageRow } from "../server/queries";
import { ResourcePageEditor } from "./resource-page-editor";

type Requester = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchResourcePages(eventId: string, request: Requester = fetch): Promise<ResourcePageRow[]> {
  const response = await request(`/api/internal/resources/${eventId}`);
  const payload = await response.json().catch(() => null) as { data?: ResourcePageRow[]; error?: { message?: string } } | null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error?.message ?? "Could not refresh resource pages");
  return payload.data;
}

export async function persistResourcePageOrder(eventId: string, orderedIds: string[], request: Requester = fetch): Promise<void> {
  const response = await request(`/api/internal/resources/${eventId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });
  if (!response.ok) throw new Error("Could not reorder pages");
}

export async function deleteResourcePage(eventId: string, page: ResourcePageRow, request: Requester = fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await request(`/api/internal/resources/${eventId}/${page.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    return response.ok
      ? { ok: true }
      : { ok: false, message: payload?.error?.message ?? "That page could not be deleted" };
  } catch {
    return { ok: false, message: "That page could not be deleted" };
  }
}

export async function completeResourcePageDelete(
  eventId: string,
  page: ResourcePageRow,
  effects: {
    onError: (message: string) => void;
    onDeleted: () => void;
    removeRow: () => void;
    refresh: () => Promise<void>;
    onRefreshError: () => void;
    closeConfirmation: () => void;
  },
  request: Requester = fetch,
): Promise<boolean> {
  const result = await deleteResourcePage(eventId, page, request);
  if (!result.ok) {
    effects.onError(result.message);
    return false;
  }
  effects.onDeleted();
  effects.removeRow();
  try {
    await effects.refresh();
  } catch {
    effects.onRefreshError();
  }
  effects.closeConfirmation();
  return true;
}

export async function completeResourcePageReorder(
  eventId: string,
  orderedIds: string[],
  effects: { rollback: () => void; onError: () => void; refresh: () => Promise<void>; onRefreshError: () => void },
  request: Requester = fetch,
): Promise<boolean> {
  try {
    await persistResourcePageOrder(eventId, orderedIds, request);
    return true;
  } catch {
    // The PATCH is authoritative. Restore the last known saved order before a
    // best-effort GET so a second network failure cannot leave an unsaved order
    // looking successful.
    effects.rollback();
    effects.onError();
    try {
      await effects.refresh();
    } catch {
      effects.onRefreshError();
    }
    return false;
  }
}

export function restoreResourcePageOrder<T extends { id: string }>(
  current: readonly T[],
  previousIds: readonly string[],
): T[] {
  const byId = new Map(current.map((page) => [page.id, page]));
  const restored = previousIds.flatMap((id) => {
    const page = byId.get(id);
    if (!page) return [];
    byId.delete(id);
    return [page];
  });
  return [...restored, ...current.filter((page) => byId.has(page.id))];
}

/**
 * Organizer CRUD for `resource_pages`. `pages` is kept in `sort_order` order —
 * the ↑/↓ controls act on that array's positions, not on whatever order a
 * clicked column header happens to be showing, so a reorder always means what
 * the arrow suggested.
 */
export function ResourcePagesAdminView({
  eventId,
  eventSlug,
  timezone,
  initialPages,
}: {
  eventId: string;
  eventSlug: string;
  timezone: string;
  initialPages: ResourcePageRow[];
}) {
  const { toast } = useToast();
  const [pages, setPages] = useState(initialPages);
  const [creating, setCreating] = useState(false);
  const [editingPage, setEditingPage] = useState<ResourcePageDTO | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ResourcePageRow | null>(null);
  const [reordering, setReordering] = useState(false);

  const refresh = useCallback(async () => {
    setPages(await fetchResourcePages(eventId));
  }, [eventId]);

  const openEditor = useCallback(async (pageId: string) => {
    setEditorLoading(true);
    setEditorOpen(true);
    try {
      const response = await fetch(`/api/internal/resources/${eventId}/${pageId}`);
      const payload = await response.json().catch(() => null) as { data?: ResourcePageDTO; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data) {
        toast(payload?.error?.message ?? "Could not load this page", { kind: "error" });
        setEditorOpen(false);
        return;
      }
      setEditingPage(payload.data);
    } catch {
      toast("Could not load this page", { kind: "error" });
      setEditorOpen(false);
    } finally {
      setEditorLoading(false);
    }
  }, [eventId, toast]);

  function closeEditor() {
    setEditorOpen(false);
    setCreating(false);
    setEditingPage(null);
  }

  const move = useCallback(async (index: number, delta: number) => {
    if (reordering) return;
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= pages.length) return;
    const previousIds = pages.map((page) => page.id);
    const reordered = [...pages];
    const [item] = reordered.splice(index, 1);
    if (!item) return;
    reordered.splice(nextIndex, 0, item);
    const orderedIds = reordered.map((page) => page.id);
    setPages(reordered);
    setReordering(true);
    try {
      await completeResourcePageReorder(eventId, orderedIds, {
        rollback: () => setPages((current) => restoreResourcePageOrder(current, previousIds)),
        onError: () => toast("Could not reorder pages", { kind: "error" }),
        refresh,
        onRefreshError: () => toast("Could not refresh pages after the failed reorder", { kind: "error" }),
      });
    } finally {
      setReordering(false);
    }
  }, [eventId, pages, reordering, toast, refresh]);

  async function remove(page: ResourcePageRow): Promise<boolean> {
    return completeResourcePageDelete(eventId, page, {
      onError: (message) => toast(message, { kind: "error" }),
      onDeleted: () => toast(`${page.title} deleted`),
      // The DELETE is authoritative. Remove the row immediately so a later
      // refresh transport failure cannot leave an item visible after it is gone.
      removeRow: () => setPages((current) => current.filter((candidate) => candidate.id !== page.id)),
      refresh,
      onRefreshError: () => toast("Page deleted, but the list could not be refreshed", { kind: "error" }),
      closeConfirmation: () => setPendingDelete(null),
    });
  }

  const columns = useMemo<Array<ColumnDef<ResourcePageRow, unknown>>>(() => [
    {
      id: "title",
      header: "Title",
      accessorKey: "title",
      cell: ({ row }) => (
        <div>
          <b>{row.original.title}</b>
          <div className="track-chip">/{row.original.slug}</div>
        </div>
      ),
    },
    {
      id: "published",
      header: "Status",
      accessorFn: (page) => page.published,
      cell: ({ row }) => <StatusBadge value={row.original.published ? "Published" : "Draft"} />,
    },
    {
      id: "updatedAt",
      header: "Updated",
      accessorKey: "updatedAt",
      cell: ({ row }) => <TzTime instant={row.original.updatedAt} tz={timezone} style="date" />,
    },
    {
      id: "order",
      header: "Order",
      enableSorting: false,
      cell: ({ row }) => {
        const index = pages.findIndex((page) => page.id === row.original.id);
        return (
          <span className="row-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={`Move ${row.original.title} up`}
              disabled={reordering || index <= 0}
              onClick={() => move(index, -1)}
            ><ArrowUp size={14} /></button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Move ${row.original.title} down`}
              disabled={reordering || index === -1 || index >= pages.length - 1}
              onClick={() => move(index, 1)}
            ><ArrowDown size={14} /></button>
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="row-actions">
          <Button size="sm" variant="secondary" onClick={() => openEditor(row.original.id)}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => setPendingDelete(row.original)}>Delete</Button>
        </span>
      ),
    },
  ], [pages, timezone, reordering, move, openEditor]);

  return (
    <main className="page">
      <PageHeader
        eyebrow="PORTALS"
        title="Resources"
        description="Wiki pages speakers read in the portal — a handbook, venue info, an FAQ."
        actions={<Button onClick={() => { setCreating(true); setEditorOpen(true); }}><Plus size={16} /> New page</Button>}
      />

      <DataTable
        columns={columns}
        data={pages}
        getRowId={(page) => page.id}
        columnVisibilityKey={`resources:${eventId}`}
        empty={
          <EmptyState
            icon={<BookOpen size={20} />}
            title="No resource pages yet"
            description="Add a Speaker Guide, venue info, or an FAQ."
            action={<Button onClick={() => { setCreating(true); setEditorOpen(true); }}>New page</Button>}
          />
        }
      />

      <ResourcePageEditor
        eventId={eventId}
        eventSlug={eventSlug}
        open={editorOpen && !editorLoading}
        page={creating ? null : editingPage}
        onClose={closeEditor}
        onSaved={async () => {
          closeEditor();
          try {
            await refresh();
          } catch {
            toast("Page saved, but the list could not be refreshed", { kind: "error" });
          }
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete “${pendingDelete.title}”?` : ""}
        body="Speakers reading this page in the portal lose access immediately. This cannot be undone."
        confirmLabel="Delete page"
        onConfirm={async () => {
          if (pendingDelete) await remove(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </main>
  );
}
