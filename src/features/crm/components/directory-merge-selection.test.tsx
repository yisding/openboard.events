/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  organizationContactSummaryDtoSchema,
  organizationIdSchema,
  type OrganizationContactSummaryDTO,
} from "@/shared/contracts";
import { DirectoryView } from "./directory-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./crm-nav", () => ({ CrmNav: () => null }));
vi.mock("./contact-create-dialog", () => ({ ContactCreateDialog: () => null }));
vi.mock("./crm-tag-create", () => ({ CrmTagCreateControl: () => null }));
vi.mock("./crm-import-dialog", () => ({ CrmImportDialog: () => null }));
vi.mock("./crm-bulk-email-dialog", () => ({ CrmBulkEmailDialog: () => null }));
vi.mock("./merge-wizard-dialog", () => ({
  MergeWizardDialog: ({ a, b }: { a: { label: string }; b: { label: string } }) =>
    <p>Merging {a.label} and {b.label}</p>,
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = organizationIdSchema.parse("c9000000-0000-4000-8000-000000000001");

function contact(id: string, firstName: string): OrganizationContactSummaryDTO {
  return organizationContactSummaryDtoSchema.parse({
    id,
    email: `${firstName.toLowerCase()}@example.com`,
    firstName,
    lastName: "Speaker",
    company: null,
    jobTitle: null,
    bioHtml: null,
    linkedinUrl: null,
    twitterUrl: null,
    websiteUrl: null,
    source: "manual",
    customFields: {},
    mergedIntoId: null,
    createdAt: "2026-08-13T18:00:00.000Z",
    updatedAt: "2026-08-13T18:00:00.000Z",
    tags: [],
    eventCount: 0,
    lastActivityAt: null,
  });
}

const ada = contact("c9000000-0000-4000-8000-000000000002", "Ada");
const grace = contact("c9000000-0000-4000-8000-000000000003", "Grace");

let container: HTMLDivElement;
let root: Root;

async function renderDirectory(rows: OrganizationContactSummaryDTO[]) {
  await act(async () => {
    root.render(
      <DirectoryView
        organizationId={organizationId}
        rows={rows}
        total={rows.length}
        page={1}
        pageSize={50}
        search=""
        tagIds={[]}
        pipelineStage={null}
        source={null}
        hasEventLink={null}
        eventId={null}
        tags={[]}
        events={[]}
        metrics={{ totalContacts: rows.length, totalWithEventLink: 0, totalTagged: 0, eventsRepresented: 0, pipelineByStage: { open: 0, won: 0, lost: 0 }, mergesRecorded: 0 }}
      />,
    );
    await Promise.resolve();
  });
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("directory merge selection", () => {
  it("keeps the merge wizard mounted after the merge refreshes the table underneath it", async () => {
    await renderDirectory([ada, grace]);

    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2);
    for (const checkbox of checkboxes) await act(async () => checkbox.click());
    await act(async () => buttonNamed("Merge selected")?.click());
    expect(container.textContent).toContain("Merging Ada Speaker and Grace Speaker");

    // What `router.refresh()` does after the merge commits: a new rows array,
    // which resets the table selection. The wizard must survive it so its
    // confirmation panel is reachable.
    await renderDirectory([contact(ada.id, "Ada")]);

    expect(container.textContent).toContain("Merging Ada Speaker and Grace Speaker");
  });
});
