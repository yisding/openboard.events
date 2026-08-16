/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  crmMergeIdSchema,
  organizationContactDtoSchema,
  organizationContactIdSchema,
  organizationIdSchema,
  type OrganizationContactDTO,
} from "@/shared/contracts";
import { MergeWizardDialog } from "./merge-wizard-dialog";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = organizationIdSchema.parse("c5000000-0000-4000-8000-000000000001");
const primaryId = organizationContactIdSchema.parse("c5000000-0000-4000-8000-000000000002");
const mergedId = organizationContactIdSchema.parse("c5000000-0000-4000-8000-000000000003");
const mergeId = crmMergeIdSchema.parse("c5000000-0000-4000-8000-000000000004");

function contact(id: string, firstName: string): OrganizationContactDTO {
  return organizationContactDtoSchema.parse({
    id, email: `${firstName.toLowerCase()}@example.com`, firstName, lastName: "Speaker",
    company: null, jobTitle: null, bioHtml: null, linkedinUrl: null, twitterUrl: null, websiteUrl: null,
    source: "manual", customFields: {}, mergedIntoId: null,
    createdAt: "2026-08-16T00:00:00.000Z", updatedAt: "2026-08-16T00:00:00.000Z",
  });
}

const referenceCounts = { eventLinks: 1, tags: 0, notes: 0, activity: 2, pipelineEntries: 0 };
const preview = { primary: contact(primaryId, "Ada"), merged: contact(mergedId, "Grace"), referenceCounts, fieldConflicts: [] };
const audit = { id: mergeId, primaryContactId: primaryId, mergedContactId: mergedId, actorUserId: null, referenceCounts, createdAt: "2026-08-16T00:00:00.000Z" };
const recovered = { ...audit, recoveryStatus: "recovered", canRecover: false };

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  refreshMock.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path.endsWith("/merge/preview")) return Promise.resolve(preview);
    if (path.endsWith(`/merge/${mergeId}/recover`)) return Promise.resolve(recovered);
    if (path.endsWith("/crm/merge")) return Promise.resolve(audit);
    throw new Error(`Unexpected api path: ${path}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("merge undo", () => {
  it("recovers the just-merged contact through the recovery endpoint", async () => {
    await act(async () => root.render(
      <MergeWizardDialog
        organizationId={organizationId}
        open
        onClose={vi.fn()}
        a={{ id: primaryId, label: "Ada", email: "ada@example.com" }}
        b={{ id: mergedId, label: "Grace", email: "grace@example.com" }}
      />,
    ));
    // Let the preview useEffect resolve.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    await act(async () => { buttonNamed("Merge into Ada")?.click(); await Promise.resolve(); });
    expect(container.textContent).toContain("Grace merged into Ada");

    // The undo affordance only exists because the commit captured the merge id.
    await act(async () => { buttonNamed("Undo merge")?.click(); await Promise.resolve(); });

    expect(apiMock).toHaveBeenCalledWith(
      `organizations/${organizationId}/crm/merge/${mergeId}/recover`,
      expect.anything(),
      { method: "POST" },
    );
    expect(container.textContent).toContain("Grace restored");
    expect(toastMock).toHaveBeenCalledWith("Restored Grace");
    // Undo is spent once recovery succeeds.
    expect(buttonNamed("Undo merge")).toBeUndefined();
  });
});
