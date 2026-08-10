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
    const response = await fetch(`/api/internal/resources/${eventId}`);
    const payload = await response.json().catch(() => null) as { data?: ResourcePageRow[] } | null;
    if (payload?.data) setPages(payload.data);
  }, [eventId]);

  const openEditor = useCallback(async (pageId: string) => {
    setEditorLoading(true);
    setEditorOpen(true);
    try {
      const response = await fetch(`/api/internal/resources/${eventId}/${pageId}`);
      const payload = await response.json().catch(() => null) as { data?: ResourcePageDTO; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data) {
        toast(payload?.error?.message ?? "Could not load this page");
        setEditorOpen(false);
        return;
      }
      setEditingPage(payload.data);
    } catch {
      toast("Could not load this page");
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

  // Reads and writes `pages` through the functional `setPages` updater rather
  // than closing over the `pages` value, so this callback's identity does not
  // have to change (and the `columns` memo below does not have to recompute)
  // on every reorder — only on an `eventId`/`reordering`/`toast` change.
  const move = useCallback(async (index: number, delta: number) => {
    if (reordering) return;
    let orderedIds: string[] | null = null;
    setPages((current) => {
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const reordered = [...current];
      const [item] = reordered.splice(index, 1);
      if (!item) return current;
      reordered.splice(nextIndex, 0, item);
      orderedIds = reordered.map((page) => page.id);
      return reordered;
    });
    if (!orderedIds) return;
    setReordering(true);
    try {
      const response = await fetch(`/api/internal/resources/${eventId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      if (!response.ok) {
        toast("Could not reorder pages");
        await refresh();
      }
    } catch {
      toast("Could not reorder pages");
      await refresh();
    } finally {
      setReordering(false);
    }
  }, [eventId, reordering, toast, refresh]);

  async function remove(page: ResourcePageRow) {
    const response = await fetch(`/api/internal/resources/${eventId}/${page.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    toast(response.ok ? `${page.title} deleted` : payload?.error?.message ?? "That page could not be deleted");
    setPendingDelete(null);
    if (response.ok) await refresh();
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
        onSaved={async () => { closeEditor(); await refresh(); }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete “${pendingDelete.title}”?` : ""}
        body="Speakers reading this page in the portal lose access immediately. This cannot be undone."
        confirmLabel="Delete page"
        onConfirm={async () => { if (pendingDelete) await remove(pendingDelete); }}
        onCancel={() => setPendingDelete(null)}
      />
    </main>
  );
}
