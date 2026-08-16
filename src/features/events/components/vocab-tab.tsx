"use client";

import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical, Plus, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z, type ZodType } from "zod";
import {
  roomDtoSchema,
  sessionFormatDtoSchema,
  tagDtoSchema,
  trackDtoSchema,
  type EventId,
  type RoomDTO,
  type SessionFormatDTO,
  type TagDTO,
  type TrackDTO,
} from "@/shared/contracts";
import { Button, ColorWell, EmptyState } from "@/shared/ui/ui-kit";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError, isDefinitiveWriteFailure } from "@/shared/lib/errors";
import type { VocabKind } from "../schemas";
import { KeyedSerialQueue } from "./keyed-serial-queue";
import { canDeleteVocabItem, restoreFailedVocabDeletion, restoreVocabOrder } from "./vocab-state";
import { DEFAULT_BRAND_COLOR } from "@/shared/lib/brand-color";

type VocabItem = TrackDTO | RoomDTO | SessionFormatDTO | TagDTO;
type VocabSaveResult = { ok: boolean; item: VocabItem };
type DeleteRecovery = {
  eventId: EventId;
  kind: VocabKind;
  item: VocabItem;
};

const deletedSchema = z.object({ deleted: z.boolean() });
const reorderedSchema = z.object({ reordered: z.boolean() });

function dtoSchemaFor(kind: VocabKind): ZodType<VocabItem> {
  switch (kind) {
    case "tracks": return trackDtoSchema;
    case "rooms": return roomDtoSchema;
    case "formats": return sessionFormatDtoSchema;
    case "tags": return tagDtoSchema;
  }
}

const COPY: Record<VocabKind, { title: string; addLabel: string; empty: string; emptyHint: string }> = {
  tracks: {
    title: "Tracks",
    addLabel: "+ Add track",
    empty: "No tracks yet",
    emptyHint: "The CFP Track question and routing rules need at least one track.",
  },
  rooms: {
    title: "Rooms",
    addLabel: "+ Add room",
    empty: "No rooms yet",
    emptyHint: "The agenda's day grid needs at least one room to show columns.",
  },
  formats: {
    title: "Formats",
    addLabel: "+ Add format",
    empty: "No formats yet",
    emptyHint: "Session formats set a default duration when scheduling a session.",
  },
  tags: {
    title: "Tags",
    addLabel: "+ Add tag",
    empty: "No tags yet",
    emptyHint: "Tags let routing rules and the abstracts table label submissions freely.",
  },
};

function hasColor(item: VocabItem): item is TrackDTO {
  return "color" in item;
}
function hasCapacity(item: VocabItem): item is RoomDTO {
  return "capacity" in item;
}
function hasDuration(item: VocabItem): item is SessionFormatDTO {
  return "defaultDurationMins" in item;
}

function Row({
  item, reorderable, reorderDisabled, mutationDisabled, deleteDisabled, onSave, onDelete,
}: {
  item: VocabItem;
  reorderable: boolean;
  reorderDisabled: boolean;
  mutationDisabled: boolean;
  deleteDisabled: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<VocabSaveResult>;
  onDelete: () => void;
}) {
  const sortable = useSortable({ id: item.id, disabled: !reorderable || reorderDisabled });
  const [name, setName] = useState(item.name);
  // On-palette jade, matching `CUSTOM_TRACK_COLOR` in the onboarding wizard.
  // The previous default was indigo (#6366f1), which is not in the palette at
  // all — see design-system.md T6.
  const [color, setColor] = useState(hasColor(item) ? item.color : DEFAULT_BRAND_COLOR);
  const [capacity, setCapacity] = useState(hasCapacity(item) ? item.capacity ?? "" : "");
  const [duration, setDuration] = useState(hasDuration(item) ? item.defaultDurationMins : 30);

  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };

  return (
    <div ref={sortable.setNodeRef} style={style} className="vocab-row">
      {reorderable && (
        <button type="button" className="icon-button" aria-label={`Reorder ${item.name}`} disabled={reorderDisabled} {...sortable.attributes} {...sortable.listeners}>
          <GripVertical size={15} />
        </button>
      )}
      {hasColor(item) && (
        <ColorWell
          value={color}
          disabled={mutationDisabled}
          className="vocab-color"
          aria-label={`Color for ${item.name}`}
          onChange={(event) => setColor(event.target.value)}
          onBlur={() => {
            if (color === item.color) return;
            const attempted = color;
            void onSave({ color: attempted }).then((result) => {
              if (!result.ok) setColor((current) => current === attempted && hasColor(result.item) ? result.item.color : current);
            });
          }}
        />
      )}
      <input
        value={name}
        disabled={mutationDisabled}
        aria-label="Name"
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const attempted = name.trim();
          if (!attempted) { setName(item.name); return; }
          setName(attempted);
          if (attempted === item.name) return;
          void onSave({ name: attempted }).then((result) => {
            if (!result.ok) setName((current) => current === attempted ? result.item.name : current);
          });
        }}
      />
      {hasCapacity(item) && (
        <input
          type="number"
          min={0}
          value={capacity}
          disabled={mutationDisabled}
          aria-label="Capacity"
          placeholder="Capacity"
          onChange={(event) => setCapacity(event.target.value)}
          onBlur={() => {
            const attempted = capacity === "" ? null : Number(capacity);
            if (attempted === item.capacity) return;
            const localValue = capacity;
            void onSave({ capacity: attempted }).then((result) => {
              if (!result.ok) setCapacity((current) => current === localValue && hasCapacity(result.item) ? result.item.capacity ?? "" : current);
            });
          }}
        />
      )}
      {hasDuration(item) && (
        <input
          type="number"
          min={5}
          max={600}
          value={duration}
          disabled={mutationDisabled}
          aria-label="Default duration (minutes)"
          onChange={(event) => setDuration(Number(event.target.value))}
          onBlur={() => {
            if (duration === item.defaultDurationMins) return;
            const attempted = duration;
            void onSave({ defaultDurationMins: attempted }).then((result) => {
              if (!result.ok) setDuration((current) => current === attempted && hasDuration(result.item) ? result.item.defaultDurationMins : current);
            });
          }}
        />
      )}
      <button type="button" className="icon-button" aria-label={`Remove ${item.name}`} disabled={deleteDisabled} onClick={onDelete}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}

/**
 * One component for all four vocabulary kinds. Tags carry no `sort_order`
 * column in the frozen schema, so they render with no drag handle and never
 * call the reorder endpoint — `reorderable` below is the single switch for
 * that.
 */
export function VocabTab({ eventId, kind, initialItems }: { eventId: EventId; kind: VocabKind; initialItems: VocabItem[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const copy = COPY[kind];
  const reorderable = kind !== "tags";

  const [items, setItems] = useState(initialItems);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VocabItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteRecovery, setDeleteRecovery] = useState<DeleteRecovery | null>(null);
  const [reordering, setReordering] = useState(false);
  const reorderPending = useRef(false);
  const reorderGeneration = useRef(0);
  const saveQueue = useRef(new KeyedSerialQueue());
  const persistedItems = useRef(new Map<string, VocabItem>(initialItems.map((item) => [item.id, item])));
  const mutationLocked = deleteBusy || deleteRecovery !== null;
  useUnsavedWorkGuard(mutationLocked, { blocking: mutationLocked });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const applyAuthoritativeItems = useCallback((authoritative: VocabItem[]) => {
    persistedItems.current = new Map(authoritative.map((item) => [item.id, item]));
    setItems(authoritative);
  }, []);

  async function requestAuthoritativeItems(): Promise<VocabItem[]> {
    return api(`events/${eventId}/vocab/${kind}`, z.array(dtoSchemaFor(kind)));
  }

  async function addItem() {
    if (mutationLocked || !newName.trim()) return;
    setAdding(true);
    try {
      const created = await api(`events/${eventId}/vocab/${kind}`, dtoSchemaFor(kind), {
        method: "POST",
        body: { name: newName.trim() },
      });
      setItems((current) => [...current, created]);
      persistedItems.current.set(created.id, created);
      setNewName("");
      toast(`${copy.title.slice(0, -1)} added`);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : `That ${copy.title.toLowerCase().slice(0, -1)} did not save`, { kind: "error" });
    } finally {
      setAdding(false);
    }
  }

  function saveItem(itemId: string, patch: Record<string, unknown>, fallbackItem: VocabItem): Promise<VocabSaveResult> {
    if (mutationLocked) return Promise.resolve({ ok: false, item: persistedItems.current.get(itemId) ?? fallbackItem });
    return saveQueue.current.run(itemId, async () => {
      try {
        const saved = await api(`events/${eventId}/vocab/${kind}/${itemId}`, dtoSchemaFor(kind), {
          method: "PATCH",
          body: patch,
        });
        persistedItems.current.set(itemId, saved);
        setItems((current) => current.map((row) => row.id === itemId ? saved : row));
        router.refresh();
        return { ok: true, item: saved };
      } catch (caught) {
        toast(isAppError(caught) ? caught.message : "That change did not save", { kind: "error" });
        return { ok: false, item: persistedItems.current.get(itemId) ?? fallbackItem };
      }
    });
  }

  async function confirmDelete() {
    if (!pendingDelete || mutationLocked || !canDeleteVocabItem(reorderPending.current)) return;
    const removed = pendingDelete;
    const originalIndex = items.findIndex((item) => item.id === removed.id);
    setItems((current) => current.filter((row) => row.id !== removed.id));
    setPendingDelete(null);
    setDeleteBusy(true);
    try {
      await api(`events/${eventId}/vocab/${kind}/${removed.id}`, deletedSchema, { method: "DELETE" });
      persistedItems.current.delete(removed.id);
      toast(`${removed.name} deleted`);
      router.refresh();
    } catch (caught) {
      setItems((current) => restoreFailedVocabDeletion(
        current,
        removed,
        originalIndex,
        persistedItems.current.get(removed.id),
      ));
      if (isDefinitiveWriteFailure(caught)) {
        try {
          applyAuthoritativeItems(await requestAuthoritativeItems());
        } catch {
          // A definitive DELETE rejection made no side effect; keep the last
          // persisted row rather than pretending the failed refresh proved a
          // different current list.
        }
        toast(caught.message, { kind: "error" });
      } else {
        setDeleteRecovery({ eventId, kind, item: removed });
        toast("That deletion is unconfirmed. Keep this page open and retry the exact deletion.", { kind: "error" });
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  async function retryExactDelete() {
    if (!deleteRecovery || deleteBusy) return;
    const operation = deleteRecovery;
    setDeleteBusy(true);
    try {
      await api(`events/${operation.eventId}/vocab/${operation.kind}/${operation.item.id}`, deletedSchema, { method: "DELETE" });
      const authoritative = await requestAuthoritativeItems();
      applyAuthoritativeItems(authoritative);
      setDeleteRecovery(null);
      toast(`Vocabulary checked: ${operation.item.name} is no longer in ${copy.title.toLowerCase()}.`);
      router.refresh();
    } catch (caught) {
      if (isDefinitiveWriteFailure(caught)) {
        try {
          applyAuthoritativeItems(await requestAuthoritativeItems());
          setDeleteRecovery(null);
          toast(caught.message, { kind: "error" });
        } catch {
          toast(`${caught.message} The current vocabulary could not be checked, so deletion recovery remains locked.`, { kind: "error" });
        }
      } else {
        toast("The deletion is still unconfirmed. Restore your connection, then retry this exact deletion.", { kind: "error" });
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    if (mutationLocked || reorderPending.current) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = items.findIndex((item) => item.id === active.id);
    const toIndex = items.findIndex((item) => item.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;
    const reordered = arrayMove(items, fromIndex, toIndex);
    const previousOrder = items.map((item) => item.id);
    const generation = reorderGeneration.current + 1;
    reorderGeneration.current = generation;
    reorderPending.current = true;
    setReordering(true);
    setItems(reordered);
    try {
      await api(`events/${eventId}/vocab/${kind}/reorder`, reorderedSchema, {
        method: "POST",
        body: { orderedIds: reordered.map((item) => item.id) },
      });
    } catch {
      if (reorderGeneration.current === generation) {
        setItems((current) => restoreVocabOrder(current, previousOrder));
      }
      toast("That reorder did not save — the previous order has been restored", { kind: "error" });
    } finally {
      if (reorderGeneration.current === generation) {
        reorderPending.current = false;
        setReordering(false);
      }
    }
  }

  return (
    <section className="panel settings-section">
      <header>
        <h2>{copy.title}</h2>
        <p>Used consistently across forms, routing, review, and the published schedule.</p>
      </header>
      {deleteRecovery && <div className="locked-banner" role="alert">
        <AlertTriangle size={17} aria-hidden />
        <div>
          <b>Deletion outcome unconfirmed</b>
          <span>We don’t know whether {deleteRecovery.item.name} was deleted. This list may be stale; other vocabulary changes and navigation are locked until the exact deletion is recovered.</span>
        </div>
        <Button size="sm" variant="secondary" disabled={deleteBusy} onClick={() => void retryExactDelete()}>
          {deleteBusy ? "Retrying…" : "Retry exact deletion"}
        </Button>
      </div>}
      {items.length === 0 ? (
        <EmptyState icon={<Plus size={20} />} title={copy.empty} description={copy.emptyHint} />
      ) : (
        <DndContext sensors={sensors} onDragEnd={(event) => { void onDragEnd(event); }}>
          <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            <div className="vocab-list">
              {items.map((item) => (
                <Row
                  key={`${item.id}:${JSON.stringify(item)}`}
                  item={item}
                  reorderable={reorderable}
                  reorderDisabled={reordering || mutationLocked}
                  mutationDisabled={mutationLocked}
                  deleteDisabled={mutationLocked || !canDeleteVocabItem(reordering)}
                  onSave={(patch) => saveItem(item.id, patch, item)}
                  onDelete={() => {
                    if (!mutationLocked && canDeleteVocabItem(reorderPending.current)) setPendingDelete(item);
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <div className="vocab-add">
        <input
          value={newName}
          aria-label={`New ${copy.title.toLowerCase().slice(0, -1)} name`}
          placeholder={`Add ${copy.title.toLowerCase().slice(0, -1)}`}
          disabled={mutationLocked}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void addItem(); }}
        />
        <Button variant="secondary" disabled={adding || mutationLocked} onClick={() => void addItem()}>
          <Plus size={15} /> Add
        </Button>
      </div>
      <ConfirmDialog
        open={pendingDelete !== null && deleteRecovery === null}
        title={`Delete ${pendingDelete?.name ?? "this item"}?`}
        body={
          kind === "tags"
            ? "Submissions tagged with it will lose the tag."
            : "Submissions using it will become uncategorized. Any routing rule that named it stays but is soft-disabled — deleting it here does not touch routing rules."
        }
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={() => { if (!mutationLocked) setPendingDelete(null); }}
      />
    </section>
  );
}
