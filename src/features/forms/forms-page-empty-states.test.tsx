/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuilderEvent, FormListRow } from "./builder-types";
import { FormsPage } from "./forms-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const event: BuilderEvent = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Empty States Conf",
  slug: "empty-states-conf",
  timezone: "America/Los_Angeles",
  submissionCapPerUser: 3,
};

const liveForm = {
  id: "10000000-0000-4000-8000-000000000101",
  internalName: "Main call for speakers",
  externalTitle: "Submit a talk",
  status: "published",
  availability: "live",
  kind: "abstract",
  targetType: "contact",
  collectParticipants: true,
  opensAt: null,
  closesAt: null,
  createdAt: "2026-08-12T12:00:00.000Z",
  submissionCount: 4,
  draftCount: 1,
  pendingCount: 0,
  currentVersion: 2,
} as FormListRow;

const mounted: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.();
});

async function render(forms: FormListRow[]): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<FormsPage event={event} initialForms={forms} />));
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

async function search(container: HTMLElement, term: string): Promise<void> {
  const field = container.querySelector<HTMLInputElement>('input[aria-label="Search forms"]');
  if (!field) throw new Error("the form search field did not render");
  await act(async () => {
    field.value = term;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const buttonNamed = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>(".empty-state button")].find((button) => button.textContent?.includes(name));

describe("submission forms empty states", () => {
  it("offers the way in when the event has no forms at all", async () => {
    const container = await render([]);
    expect(container.querySelector(".empty-state h3")?.textContent).toBe("No forms yet");
    expect(buttonNamed(container, "Create form")).toBeDefined();
  });

  it("does not tell an organizer with forms to create one when a search matched nothing", async () => {
    const container = await render([liveForm]);
    await search(container, "nothing matches this");

    expect(container.querySelector(".empty-state h3")?.textContent).toBe("No forms match that search");
    expect(container.querySelector(".empty-state p")?.textContent).toContain("the one form");
    expect(buttonNamed(container, "Create form")).toBeUndefined();

    const clear = buttonNamed(container, "Clear search");
    if (!clear) throw new Error("an emptied search must offer the way back");
    await act(async () => clear.click());
    expect(container.querySelector(".empty-state")).toBeNull();
    expect(container.textContent).toContain("Main call for speakers");
  });

  it("names the filter tab that emptied the list, not the event", async () => {
    const container = await render([liveForm]);
    const draftTab = [...container.querySelectorAll<HTMLButtonElement>(".tabs button")]
      .find((button) => button.textContent?.startsWith("Draft"));
    if (!draftTab) throw new Error("the Draft filter tab did not render");
    await act(async () => draftTab.click());

    expect(container.querySelector(".empty-state h3")?.textContent).toBe("No draft forms");
    const showAll = buttonNamed(container, "Show all forms");
    if (!showAll) throw new Error("a filtered-empty list must offer the way back to every form");
    await act(async () => showAll.click());
    expect(container.textContent).toContain("Main call for speakers");
  });
});
