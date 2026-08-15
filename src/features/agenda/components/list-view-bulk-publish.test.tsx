/** @vitest-environment happy-dom */

import * as React from "react";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventId, ScheduledSessionDTO, SessionId } from "@/shared/contracts";
import type { DataTableSelectionContext } from "@/shared/ui/app/data-table";
import { ListView } from "./list-view";

const mutations = vi.hoisted(() => ({ setPublished: vi.fn() }));

vi.mock("../hooks/use-session-mutations", () => ({
  useSessionMutations: () => ({
    setPublished: { isPending: false, mutateAsync: mutations.setPublished },
  }),
}));
vi.mock("@/shared/ui/app/confirm-dialog", () => ({
  ConfirmDialog: ({ open, title, confirmLabel, onConfirm }: {
    open: boolean;
    title: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  }) => (open
    ? <div><h2>{title}</h2><button type="button" onClick={() => void onConfirm()}>{confirmLabel}</button></div>
    : null),
}));
// The identity-sensitive dependency is the point, and it is deliberately
// stricter than the real DataTable, which keeps the callback in a ref and
// notifies only on a real selection change. Re-notifying on every callback
// identity is the worst case this view has to survive, so the mock pins it.
vi.mock("@/shared/ui/app/data-table", () => ({
  nullsLast: () => 0,
  DataTable: <Row,>({ data, onSelectionChange, renderSelectionBar, selectionEpoch }: {
    data: Row[];
    onSelectionChange?: (rows: Row[]) => void;
    renderSelectionBar?: (selection: DataTableSelectionContext<Row>) => React.ReactNode;
    selectionEpoch?: number;
  }) => {
    const [selected, setSelected] = useState<Row[]>([]);
    useEffect(() => {
      setSelected([]);
      onSelectionChange?.([]);
    }, [onSelectionChange, selectionEpoch]);
    const update = (next: Row[]) => {
      setSelected(next);
      onSelectionChange?.(next);
    };
    return <div>
      <button type="button" onClick={() => update(data.slice(0, 1))}>Select draft</button>
      {selected.length > 0 && renderSelectionBar?.({
        selectedRows: selected,
        countLabel: `${selected.length} selected`,
        clearSelection: () => update([]),
        scope: "page",
        pageSelectedCount: selected.length,
        pageRowCount: data.length,
        totalRowCount: data.length,
      })}
    </div>;
  },
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = "a0000000-0000-4000-8000-000000000001" as EventId;
const session: ScheduledSessionDTO = {
  id: "a0000000-0000-4000-8000-000000000010" as SessionId,
  title: "Migrating from bespoke to boring",
  slug: "migrating-from-bespoke-to-boring",
  descriptionHtml: "",
  startsAt: "2026-10-18T16:00:00.000Z",
  endsAt: "2026-10-18T16:30:00.000Z",
  trackId: null,
  roomId: null,
  formatId: null,
  status: "draft",
  scheduleRevision: 0,
  rowVersion: 1,
  speakerIds: [],
};

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.replace(/\s+/gu, " ").trim() === name);
}

beforeEach(() => {
  mutations.setPublished.mockReset();
  mutations.setPublished.mockResolvedValue({ changed: 1, emailsQueued: 0 });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderList() {
  await act(async () => root.render(<ListView
    eventId={eventId}
    event={{ timezone: "America/Los_Angeles", startsAt: "2026-10-18T16:00:00.000Z", endsAt: "2026-10-20T02:00:00.000Z" }}
    sessions={[session]}
    conflicts={[]}
    rooms={[]}
    tracks={[]}
    formats={[]}
    speakers={[]}
    accepted={[]}
  />));
}

describe("Agenda list view bulk publish", () => {
  it("keeps the confirm dialog open after selecting a scheduled draft", async () => {
    await renderList();

    await act(async () => buttonNamed("Select draft")?.click());
    await act(async () => buttonNamed("Publish selected")?.click());

    expect(container.textContent).toContain("Publish 1 session?");
  });

  it("publishes the reviewed candidates once confirmed", async () => {
    await renderList();

    await act(async () => buttonNamed("Select draft")?.click());
    await act(async () => buttonNamed("Publish selected")?.click());
    await act(async () => buttonNamed("Publish sessions")?.click());

    expect(mutations.setPublished).toHaveBeenCalledWith({ ids: [session.id], published: true });
    expect(container.textContent).not.toContain("Publish 1 session?");
  });
});
