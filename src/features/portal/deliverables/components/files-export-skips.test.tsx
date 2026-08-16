/** @vitest-environment happy-dom */

import * as React from "react";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  contactIdSchema,
  deliverableRowDtoSchema,
  eventIdSchema,
  fileRequestIdSchema,
  taskIdSchema,
  type DeliverableRowDTO,
} from "@/shared/contracts";
import type { DataTableSelectionContext } from "@/shared/ui/app/data-table";
import { FilesAdminView } from "./files-admin-view";
import { settle } from "@tests/support/react";

const toastMock = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/events/11111111-1111-4111-8111-111111111111/files",
  useSearchParams: () => navigation.params,
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => () => undefined,
  useGuardedAction: () => ({ runGuarded: (action: () => void) => action() }),
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
      <button type="button" onClick={() => update(data)}>Select all rows</button>
      <button type="button" onClick={() => update(data.filter((_, index) => index < 2))}>Select the uploaded rows</button>
      {renderSelectionBar?.({
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

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("e3000000-0000-4000-8000-000000000001");

function row(index: number, uploaded: boolean): DeliverableRowDTO {
  const suffix = String(index).padStart(12, "0");
  return deliverableRowDtoSchema.parse({
    taskId: taskIdSchema.parse(`e3000000-0000-4000-8000-${suffix}`),
    taskName: "Upload slides",
    fileRequestId: fileRequestIdSchema.parse(`e3000000-0000-4000-8001-${suffix}`),
    fileRequestTitle: "Final slides",
    contactId: contactIdSchema.parse(`e3000000-0000-4000-8002-${suffix}`),
    contactName: `Speaker ${index}`,
    submissionId: null,
    submissionTitle: null,
    dueAt: null,
    completed: uploaded,
    completedAt: null,
    overdue: false,
    latestVersion: uploaded
      ? {
        fileUploadId: `e3000000-0000-4000-8003-${suffix}`,
        fileAssetId: `e3000000-0000-4000-8004-${suffix}`,
        version: 1,
        isLatest: true,
        filename: `deck-${index}.pdf`,
        sizeBytes: 1024,
        mime: "application/pdf",
        uploadedAt: "2026-08-11T00:00:00.000Z",
      }
      : null,
    versionCount: uploaded ? 1 : 0,
    commentCount: 0,
  });
}

/** Four selectable slots, two of which nobody has uploaded to yet. */
const rows = [row(1, true), row(2, true), row(3, false), row(4, false)];

const pendingJob = {
  id: "e3000000-0000-4000-8005-000000000001",
  status: "pending",
  groupBy: "none",
  entryCount: 0,
  resultFileId: null,
  error: null,
  createdAt: "2026-08-11T00:00:00.000Z",
  completedAt: null,
  expiresAt: "2026-08-12T00:00:00.000Z",
};
const completedJob = {
  ...pendingJob,
  status: "completed",
  entryCount: 2,
  resultFileId: "e3000000-0000-4000-8006-000000000001",
  completedAt: "2026-08-11T00:01:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.replace(/\s+/gu, " ").trim() === name);
}

async function chooseExport() {
  const select = [...container.querySelectorAll<HTMLSelectElement>("select")]
    .find((element) => element.getAttribute("aria-label") === "Group export by");
  if (!select) throw new Error("expected the export menu");
  await act(async () => {
    select.value = "speaker";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function exportBanner(): string {
  return [...container.querySelectorAll(".notify-bar")]
    .map((bar) => bar.textContent?.replace(/\s+/gu, " ").trim() ?? "")
    .join(" ");
}

async function mount() {
  await act(async () => root.render(<FilesAdminView
    eventId={eventId}
    rows={rows}
    counts={{ all: rows.length, open: 2, overdue: 0, completed: 2 }}
    state="all"
    taskId=""
    fileRequestId=""
    hasUpload=""
    search=""
    fileRequests={[]}
    tasks={[]}
  />));
}

beforeEach(() => {
  toastMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Files ZIP export of a mixed selection", () => {
  it("sends only the rows that have a file and says how many it left behind", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: pendingJob }));
    await mount();

    await act(async () => buttonNamed("Select all rows")?.click());
    await chooseExport();
    await settle();

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)) as { targets: unknown[] };
    expect(body.targets).toHaveLength(2);
    expect(exportBanner()).toContain("2 selected deliverables had no file uploaded yet and were left out");
  });

  it("keeps the gap next to the finished ZIP, where the download is", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: completedJob }));
    await mount();

    await act(async () => buttonNamed("Select all rows")?.click());
    await chooseExport();
    await settle();

    const banner = exportBanner();
    expect(banner).toContain("Export ready");
    expect(banner).toContain("2 files zipped");
    expect(banner).toContain("2 selected deliverables had no file uploaded yet and were left out");
  });

  it("says nothing about skips when every selected row had a file", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: completedJob }));
    await mount();

    await act(async () => buttonNamed("Select the uploaded rows")?.click());
    await chooseExport();
    await settle();

    expect(exportBanner()).toContain("2 files zipped");
    expect(exportBanner()).not.toContain("left out");
  });
});
