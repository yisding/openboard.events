/** @vitest-environment happy-dom */

// The Unavailability panel used to read "Blackout windows in America/Los_Angeles,
// applied by M54 when placing this speaker on the schedule" — an internal
// milestone codename and a raw IANA zone id, both meaningless to an organizer.
// This guards the friendly replacement copy (issue #670).

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpeakerRosterExtras } from "@/features/portal";
import { SpeakerRosterPanels } from "./speaker-roster-panels";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({ useUnsavedWorkGuard: () => {} }));
vi.mock("@/shared/ui/app/datetime-picker", () => ({ DateTimePicker: () => null }));
vi.mock("@/shared/ui/app/private-file-link", () => ({ PrivateFileLink: () => null }));
vi.mock("@/shared/ui/app/tz-time", () => ({ TzTime: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const extras: SpeakerRosterExtras = { workflowStatus: "new", fields: [], values: [], unavailability: [], uploads: [] };

async function renderPanels(timezone: string): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(
    <SpeakerRosterPanels
      eventId="00000000-0000-4000-8000-000000000001"
      contactId="00000000-0000-4000-8000-000000000002"
      timezone={timezone}
      initialExtras={extras}
    />,
  ));
  return { container, root };
}

function unavailabilityCopy(container: HTMLDivElement): string {
  const section = [...container.querySelectorAll("section")]
    .find((candidate) => candidate.querySelector("h2")?.textContent === "Unavailability");
  const copy = section?.querySelector("p")?.textContent;
  if (!copy) throw new Error("Missing Unavailability panel copy");
  return copy;
}

let harness: { container: HTMLDivElement; root: Root } | null = null;

afterEach(async () => {
  if (harness) {
    await act(async () => harness?.root.unmount());
    harness.container.remove();
    harness = null;
  }
});

describe("speaker roster unavailability panel copy", () => {
  it("describes the zone in plain English and drops the internal milestone name", async () => {
    harness = await renderPanels("America/Los_Angeles");
    const copy = unavailabilityCopy(harness.container);
    expect(copy).toContain("Pacific Time — Los Angeles");
    expect(copy).toContain("applied automatically when placing this speaker on the schedule");
    expect(copy).not.toContain("America/Los_Angeles");
    expect(copy).not.toContain("M54");
  });

  it("still reads cleanly for a zone with no generic long name", async () => {
    harness = await renderPanels("UTC");
    const copy = unavailabilityCopy(harness.container);
    expect(copy).toContain("Blackout windows in UTC");
    expect(copy).not.toContain("M54");
  });
});
