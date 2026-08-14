/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeakersAdminView } from "./speakers-admin-view";
import { SpeakerStatusOptions } from "./speaker-status-options";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
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
  UnreadableBulkSendRecovery: () => null,
  BulkReminderRecoveryDialog: () => null,
  useBulkReminderRecovery: () => ({
    blocked: false,
    recovery: null,
    sending: false,
    unreadable: false,
    start: vi.fn(),
    retry: vi.fn(),
    finishCleanup: vi.fn(),
    clearUnreadable: vi.fn(),
  }),
}));
vi.mock("@/shared/ui/app/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/shared/ui/app/data-table", () => ({ DataTable: () => null }));
vi.mock("@/shared/ui/app/use-flow-keyboard-nav", () => ({ useFlowKeyboardNav: () => undefined }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("./speaker-bulk-email-dialog", () => ({ SpeakerBulkEmailDialog: () => null }));
vi.mock("./speaker-create-dialog", () => ({ SpeakerCreateDialog: () => null }));
vi.mock("./speaker-flow-drawer", () => ({ SpeakerFlowDrawer: () => null }));
vi.mock("./speaker-import-dialog", () => ({ SpeakerImportDialog: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  navigation.params = new URLSearchParams("q=ada&accepted=1&missing=bio&confirmation=confirmed&page=4");
  navigation.push.mockReset();
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function filterButton(name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Filter speakers"] button')]
    .find((candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === name);
  if (!button) throw new Error(`Missing speaker filter button: ${name}`);
  return button;
}

describe("speaker status selection accessibility", () => {
  it("renders one named button group whose current value is programmatically pressed", () => {
    const html = renderToStaticMarkup(
      <SpeakerStatusOptions
        label="Speaker confirmation status"
        options={["unconfirmed", "confirmed", "declined"]}
        value="confirmed"
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('role="group" aria-label="Speaker confirmation status"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="true" class="active"[^>]*>confirmed<\/button>/);
  });

  it("reports a newly selected status from the pressed-state control", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<SpeakerStatusOptions
      label="Speaker pipeline status"
      options={["ready", "needs_assets"]}
      value="ready"
      onChange={onChange}
    />));

    const needsAssets = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "needs assets");
    if (!needsAssets) throw new Error("Missing needs assets status option");
    await act(async () => needsAssets.click());
    expect(onChange).toHaveBeenCalledWith("needs_assets");
  });

  it("renders counted combinable filters and preserves the rest of the roster URL when they change", async () => {
    await act(async () => root.render(<SpeakersAdminView
      eventId="event-1"
      rows={[]}
      total={84}
      filterCounts={{ all: 84, accepted: 31, missingEither: 12, missingBio: 7, missingHeadshot: 9 }}
      page={4}
      pageSize={50}
      q="ada"
      accepted
      missing="bio"
      confirmation="confirmed"
      sort="name"
      dir="asc"
    />));

    expect(filterButton("All 84").getAttribute("aria-pressed")).toBe("false");
    expect(filterButton("Accepted 31").getAttribute("aria-pressed")).toBe("true");
    expect(filterButton("Any profile gap 12").getAttribute("aria-pressed")).toBe("false");
    expect(filterButton("Bio missing 7").getAttribute("aria-pressed")).toBe("true");
    expect(filterButton("Headshot missing 9").getAttribute("aria-pressed")).toBe("false");

    await act(async () => filterButton("Headshot missing 9").click());
    expect(navigation.push).toHaveBeenLastCalledWith("?q=ada&accepted=1&missing=headshot&confirmation=confirmed");

    await act(async () => filterButton("Accepted 31").click());
    expect(navigation.push).toHaveBeenLastCalledWith("?q=ada&missing=bio&confirmation=confirmed");

    await act(async () => filterButton("All 84").click());
    expect(navigation.push).toHaveBeenLastCalledWith("?q=ada&confirmation=confirmed");
  });
});
