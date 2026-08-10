"use client";

import { createContext, useContext, useMemo, useRef, useSyncExternalStore } from "react";
import type { ConflictDTO, SessionId } from "@/shared/contracts";

/**
 * The Day view's ephemeral, client-only state: the live conflict outline list
 * (recomputed on every optimistic patch, before the server round trip) and
 * which session is mid-drag. Exactly the "drag ghost / active view / day"
 * category of state app-architecture's litmus test allows in a client store —
 * never persisted, never server truth, and cleared automatically because the
 * store lives in a ref inside a provider that unmounts with the Day view.
 *
 * The project has no `zustand` dependency, so this is a small hand-rolled
 * store with the same shape (a plain object, `useSyncExternalStore` under the
 * hood) rather than an added package for one file's worth of state.
 */

type DayGridSnapshot = {
  conflicts: ConflictDTO[];
  draggingId: SessionId | null;
};

type Listener = () => void;

type DayGridStore = {
  getSnapshot: () => DayGridSnapshot;
  subscribe: (listener: Listener) => () => void;
  setConflicts: (conflicts: ConflictDTO[]) => void;
  setDragging: (draggingId: SessionId | null) => void;
};

function createDayGridStore(): DayGridStore {
  let snapshot: DayGridSnapshot = { conflicts: [], draggingId: null };
  const listeners = new Set<Listener>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setConflicts(conflicts) {
      if (snapshot.conflicts === conflicts) return;
      snapshot = { ...snapshot, conflicts };
      emit();
    },
    setDragging(draggingId) {
      if (snapshot.draggingId === draggingId) return;
      snapshot = { ...snapshot, draggingId };
      emit();
    },
  };
}

const DayGridContext = createContext<DayGridStore | null>(null);

/** Wraps one Day view mount. A fresh store per mount is the "cleared on unmount" half of the contract. */
export function DayGridStateProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<DayGridStore | null>(null);
  ref.current ??= createDayGridStore();
  return <DayGridContext.Provider value={ref.current}>{children}</DayGridContext.Provider>;
}

function useDayGridStore(): DayGridStore {
  const store = useContext(DayGridContext);
  if (!store) throw new Error("useDayGridState hooks must be used inside <DayGridStateProvider>");
  return store;
}

/** The current day's conflict list — `session-card.tsx` reads this to paint its outline. */
export function useDayGridConflicts(): ConflictDTO[] {
  const store = useDayGridStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().conflicts, () => store.getSnapshot().conflicts);
}

export function useDayGridDraggingId(): SessionId | null {
  const store = useDayGridStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().draggingId, () => store.getSnapshot().draggingId);
}

/** Stable setters for `day-view.tsx`'s effects and drag handlers. */
export function useDayGridActions() {
  const store = useDayGridStore();
  return useMemo(() => ({ setConflicts: store.setConflicts, setDragging: store.setDragging }), [store]);
}
