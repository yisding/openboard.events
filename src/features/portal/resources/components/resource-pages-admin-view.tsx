"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { AlertTriangle, ArrowDown, ArrowUp, BookOpen, Plus } from "lucide-react";
import { apiDataSchema, apiErrorSchema } from "@/shared/contracts";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { DataTable } from "@/shared/ui/app/data-table";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, EmptyState, PageHeader, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { ResourcePageDTO, ResourcePageRow } from "../server/queries";
import { ResourcePageEditor } from "./resource-page-editor";

type Requester = (input: string, init?: RequestInit) => Promise<Response>;

const resourcePageRowSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  slug: z.string(),
  summary: z.string(),
  published: z.boolean(),
  sortOrder: z.number(),
  updatedAt: z.string(),
});
const resourcePageListSchema = apiDataSchema(z.array(resourcePageRowSchema));
const deletedResourcePageSchema = apiDataSchema(z.object({ ok: z.literal(true) }));

type DeleteResourcePageResult =
  | { kind: "confirmed" }
  | { kind: "definitive"; message: string }
  | { kind: "ambiguous" };

type ResourcePageDeleteRecovery = {
  eventId: string;
  page: ResourcePageRow;
};

export async function fetchResourcePages(eventId: string, request: Requester = fetch): Promise<ResourcePageRow[]> {
  const response = await request(`/api/internal/resources/${eventId}`);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload);
    throw new Error(parsedError.success ? parsedError.data.error.message : "Could not refresh resource pages");
  }
  const parsed = resourcePageListSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Could not refresh resource pages");
  return parsed.data.data;
}

export async function persistResourcePageOrder(eventId: string, orderedIds: string[], request: Requester = fetch): Promise<void> {
  const response = await request(`/api/internal/resources/${eventId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderedIds }),
  });
  if (!response.ok) throw new Error("Could not reorder pages");
}

export async function deleteResourcePage(eventId: string, page: ResourcePageRow, request: Requester = fetch): Promise<DeleteResourcePageResult> {
  try {
    const response = await request(`/api/internal/resources/${eventId}/${page.id}`, { method: "DELETE" });
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) {
      return deletedResourcePageSchema.safeParse(payload).success ? { kind: "confirmed" } : { kind: "ambiguous" };
    }
    const parsedError = apiErrorSchema.safeParse(payload);
    if (!parsedError.success || parsedError.data.error.code === "INTERNAL") return { kind: "ambiguous" };
    return { kind: "definitive", message: parsedError.data.error.message };
  } catch {
    return { kind: "ambiguous" };
  }
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
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteRecovery, setDeleteRecovery] = useState<ResourcePageDeleteRecovery | null>(null);
  const [reordering, setReordering] = useState(false);
  const deleteInFlight = useRef(false);
  const mutationLocked = deleteBusy || deleteRecovery !== null;
  useUnsavedWorkGuard(mutationLocked, { blocking: mutationLocked });

  const requestAuthoritativePages = useCallback(async () => fetchResourcePages(eventId), [eventId]);

  const refresh = useCallback(async () => {
    setPages(await requestAuthoritativePages());
  }, [requestAuthoritativePages]);

  const applyCheckedPages = useCallback((authoritative: ResourcePageRow[], operation: ResourcePageDeleteRecovery) => {
    setPages(authoritative);
    const absent = !authoritative.some((page) => page.id === operation.page.id);
    toast(absent
      ? `Resources checked: “${operation.page.title}” is not in the current resource list.`
      : `Resources checked: “${operation.page.title}” is currently in the resource list.`);
    return absent;
  }, [toast]);

  const startCreate = useCallback(() => {
    if (mutationLocked || reordering) return;
    setCreating(true);
    setEditorOpen(true);
  }, [mutationLocked, reordering]);

  const openEditor = useCallback(async (pageId: string) => {
    if (mutationLocked || reordering) return;
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
  }, [eventId, mutationLocked, reordering, toast]);

  function closeEditor() {
    setEditorOpen(false);
    setCreating(false);
    setEditingPage(null);
  }

  async function settleConfirmedDelete(operation: ResourcePageDeleteRecovery, recovering: boolean): Promise<void> {
    try {
      const authoritative = await requestAuthoritativePages();
      if (recovering) applyCheckedPages(authoritative, operation);
      else {
        setPages(authoritative);
        toast(`${operation.page.title} deleted`);
      }
      setDeleteRecovery(null);
    } catch {
      if (recovering) {
        toast("The deletion was accepted, but the current resource list could not be checked. Recovery remains locked; restore your connection and check resources.", { kind: "error" });
      } else {
        setPages((current) => current.filter((page) => page.id !== operation.page.id));
        toast("Page deleted, but the current resource list could not be refreshed", { kind: "error" });
      }
    }
  }

  async function requestDelete(operation: ResourcePageDeleteRecovery, recovering: boolean): Promise<void> {
    const result = await deleteResourcePage(operation.eventId, operation.page);
    if (result.kind === "confirmed") {
      await settleConfirmedDelete(operation, recovering);
      return;
    }
    if (result.kind === "definitive") {
      if (!recovering) {
        setDeleteRecovery(null);
        toast(result.message, { kind: "error" });
        return;
      }
      try {
        const authoritative = await requestAuthoritativePages();
        if (applyCheckedPages(authoritative, operation)) {
          setDeleteRecovery(null);
        } else {
          toast(`${result.message} The page is currently still listed, so retry the exact deletion before leaving.`, { kind: "error" });
        }
      } catch {
        toast(`${result.message} The current resource list could not be checked, so deletion recovery remains locked.`, { kind: "error" });
      }
      return;
    }
    setDeleteRecovery(operation);
    toast(recovering
      ? "The deletion is still unconfirmed. Restore your connection, then retry this exact deletion or check resources."
      : "That deletion is unconfirmed. Keep this page open and retry the exact deletion or check resources.", { kind: "error" });
  }

  async function remove(page: ResourcePageRow): Promise<void> {
    if (deleteInFlight.current || deleteRecovery || reordering) return;
    const operation = { eventId, page };
    deleteInFlight.current = true;
    setDeleteBusy(true);
    setPendingDelete(null);
    try {
      await requestDelete(operation, false);
    } finally {
      deleteInFlight.current = false;
      setDeleteBusy(false);
    }
  }

  async function retryExactDelete(): Promise<void> {
    if (!deleteRecovery || deleteInFlight.current) return;
    const operation = deleteRecovery;
    deleteInFlight.current = true;
    setDeleteBusy(true);
    try {
      await requestDelete(operation, true);
    } finally {
      deleteInFlight.current = false;
      setDeleteBusy(false);
    }
  }

  async function checkResources(): Promise<void> {
    if (!deleteRecovery || deleteInFlight.current) return;
    const operation = deleteRecovery;
    deleteInFlight.current = true;
    setDeleteBusy(true);
    try {
      const authoritative = await requestAuthoritativePages();
      if (applyCheckedPages(authoritative, operation)) {
        setDeleteRecovery(null);
      } else {
        toast("The page is currently still listed. The earlier deletion may still be finishing; retry the exact deletion before leaving.", { kind: "error" });
      }
    } catch {
      toast("Resources still could not be checked. Restore your connection, then retry this exact deletion or check again.", { kind: "error" });
    } finally {
      deleteInFlight.current = false;
      setDeleteBusy(false);
    }
  }

  const move = useCallback(async (index: number, delta: number) => {
    if (reordering || mutationLocked) return;
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
  }, [eventId, pages, reordering, mutationLocked, toast, refresh]);

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
      cell: ({ row }) => <StatusBadge value={row.original.published ? "published" : "draft"} />,
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
              disabled={reordering || mutationLocked || index <= 0}
              onClick={() => move(index, -1)}
            ><ArrowUp size={14} /></button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Move ${row.original.title} down`}
              disabled={reordering || mutationLocked || index === -1 || index >= pages.length - 1}
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
          <Button size="sm" variant="secondary" disabled={mutationLocked || reordering} onClick={() => openEditor(row.original.id)}>Edit</Button>
          <Button size="sm" variant="ghost" disabled={mutationLocked || reordering} onClick={() => {
            if (!mutationLocked && !reordering) setPendingDelete(row.original);
          }}>Delete</Button>
        </span>
      ),
    },
  ], [pages, timezone, reordering, mutationLocked, move, openEditor]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="PORTALS"
        title="Resources"
        description="Wiki pages speakers read in the portal — a handbook, venue info, an FAQ."
        actions={<Button disabled={mutationLocked || reordering} onClick={startCreate}><Plus size={16} /> New page</Button>}
      />

      {deleteRecovery && <div className="locked-banner" role="alert">
        <AlertTriangle size={17} aria-hidden />
        <div>
          <b>Page deletion outcome unconfirmed</b>
          <span>We don’t know whether “{deleteRecovery.page.title}” was deleted. The resource list may be stale; other resource changes and navigation are locked until recovery finishes.</span>
        </div>
        <Button size="sm" variant="secondary" disabled={deleteBusy} onClick={() => void retryExactDelete()}>
          {deleteBusy ? "Working…" : "Retry exact deletion"}
        </Button>
        <Button size="sm" variant="secondary" disabled={deleteBusy} onClick={() => void checkResources()}>
          {deleteBusy ? "Checking…" : "Check resources"}
        </Button>
      </div>}

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
            action={<Button disabled={mutationLocked || reordering} onClick={startCreate}>New page</Button>}
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
        open={pendingDelete !== null && deleteRecovery === null}
        title={pendingDelete ? `Delete “${pendingDelete.title}”?` : ""}
        body="Speakers reading this page in the portal lose access immediately. This cannot be undone."
        confirmLabel="Delete page"
        onConfirm={async () => {
          if (pendingDelete) await remove(pendingDelete);
        }}
        onCancel={() => { if (!mutationLocked) setPendingDelete(null); }}
      />
    </div>
  );
}
