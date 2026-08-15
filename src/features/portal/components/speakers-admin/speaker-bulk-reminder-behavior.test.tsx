/** @vitest-environment happy-dom */

import * as React from "react";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactListRow } from "@/features/portal";
import type { DataTableSelectionContext } from "@/shared/ui/app/data-table";
import { SpeakersAdminView } from "./speakers-admin-view";
import { settle } from "@tests/support/react";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
const recovery = vi.hoisted(() => ({
  onAcknowledged: undefined as (() => void) | undefined,
  start: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => navigation.params,
}));
vi.mock("@/features/comms/index.bulk-send-recovery", () => ({
  bulkSendRecoveryStorageKey: () => "speaker-email-recovery",
  loadBulkSendRecovery: () => ({ ok: true, snapshot: null }),
  speakerBulkSendRecoveryIdentity: () => ({ eventId: "event-1" }),
}));
vi.mock("@/features/comms/index.client", () => ({
  BulkReminderRecoveryDialog: () => null,
  UnreadableBulkSendRecovery: () => null,
  bulkReminderTargetSetFingerprint: (targets: Array<{ taskId: string; contactId: string; submissionId: string | null }>) => (
    targets.map((target) => `${target.taskId}:${target.contactId}:${target.submissionId ?? ""}`).sort().join("|")
  ),
  useBulkReminderRecovery: (options: { onAcknowledged: () => void }) => {
    recovery.onAcknowledged = options.onAcknowledged;
    return {
      blocked: false,
      confirmedButUnsynced: false,
      recovery: null,
      sending: false,
      unreadable: false,
      start: recovery.start,
      retry: vi.fn(),
      finishCleanup: vi.fn(),
      clearUnreadable: vi.fn(),
    };
  },
}));
vi.mock("@/shared/ui/app/confirm-dialog", () => ({
  ConfirmDialog: ({ open, confirmLabel, onConfirm }: { open: boolean; confirmLabel: string; onConfirm: () => Promise<void> }) => (
    open ? <button type="button" onClick={() => void onConfirm()}>{confirmLabel}</button> : null
  ),
}));
vi.mock("@/shared/ui/app/data-table", () => ({
  DataTable: <Row,>({
    data,
    onSelectionChange,
    renderSelectionBar,
    selectionEpoch,
  }: {
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
      <button type="button" onClick={() => update(data.slice(0, 1))}>Select Ada</button>
      {selected.length > 0 && renderSelectionBar?.({
        selectedRows: selected,
        countLabel: `${selected.length} selected`,
        clearSelection: () => update([]),
        scope: "page",
        pageSelectedCount: selected.length,
        pageRowCount: data.length,
        totalRowCount: data.length,
        selectAllRows: () => update(data),
      })}
    </div>;
  },
}));
vi.mock("@/shared/ui/app/use-flow-keyboard-nav", () => ({ useFlowKeyboardNav: () => undefined }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("./speaker-bulk-email-dialog", () => ({ SpeakerBulkEmailDialog: () => null }));
vi.mock("./speaker-create-dialog", () => ({ SpeakerCreateDialog: () => null }));
vi.mock("./speaker-flow-drawer", () => ({ SpeakerFlowDrawer: () => null }));
vi.mock("./speaker-headshot", () => ({ SpeakerHeadshot: () => null }));
vi.mock("./speaker-import-dialog", () => ({ SpeakerImportDialog: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = "a0000000-0000-4000-8000-000000000001";
const contactId = "a0000000-0000-4000-8000-000000000010" as ContactListRow["contactId"];
const taskId = "a0000000-0000-4000-8000-000000000020";
const row: ContactListRow = {
  contactId,
  name: "Ada Lovelace",
  email: "ada@example.com",
  jobTitle: "Programmer",
  company: "Analytical Engines",
  headshotFileId: null,
  confirmationStatus: "confirmed",
  isAcceptedSpeaker: true,
  submissionCount: 1,
  openTasks: 1,
  overdueTasks: 1,
  missingBio: false,
  missingHeadshot: true,
};

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.replace(/\s+/gu, " ").trim() === name);
}


beforeEach(() => {
  navigation.params = new URLSearchParams();
  navigation.push.mockReset();
  navigation.replace.mockReset();
  recovery.onAcknowledged = undefined;
  recovery.start.mockReset();
  recovery.start.mockResolvedValue(true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ taskId, submissionId: null }] }),
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Speakers bulk reminder behavior", () => {
  it("resolves selected speakers to exact assignments and clears only after acknowledgement", async () => {
    await act(async () => root.render(<SpeakersAdminView
      eventId={eventId}
      timezone="America/Los_Angeles"
      rows={[row]}
      total={1}
      filterCounts={{ all: 1, accepted: 1, missingEither: 1, missingBio: 0, missingHeadshot: 1 }}
      page={1}
      pageSize={50}
      q=""
      accepted={false}
      missing={null}
      confirmation={null}
      sort="name"
      dir="asc"
    />));

    await act(async () => buttonNamed("Select Ada")?.click());
    await act(async () => buttonNamed("Send reminder")?.click());
    await act(async () => buttonNamed("Queue reminders")?.click());
    await settle();

    expect(fetch).toHaveBeenCalledWith(`/api/internal/comms/${eventId}/open-assignments?contactId=${contactId}`);
    expect(recovery.start).toHaveBeenCalledOnce();
    expect(recovery.start).toHaveBeenCalledWith([{ taskId, contactId, submissionId: null }]);
    expect(buttonNamed("Send reminder")).toBeDefined();

    await act(async () => recovery.onAcknowledged?.());
    await settle();

    expect(buttonNamed("Send reminder")).toBeUndefined();
    expect(buttonNamed("Queue reminders")).toBeUndefined();
    expect(recovery.start).toHaveBeenCalledOnce();
  });
});
