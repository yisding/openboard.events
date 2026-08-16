/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  organizationContactIdSchema,
  organizationIdSchema,
} from "@/shared/contracts";
import { ContactDetailView } from "./contact-detail-view";

/**
 * Creating a tag from a contact's own Tags panel attaches it to that contact.
 *
 * The create control POSTs the new tag and hands it back; the contact page used
 * to only drop it into the org's tag list, so the chip rendered as if applied
 * while `organization_contact_tag_links` had no row — the organizer had to
 * click the chip a second time to fire the PUT that actually linked it. One
 * action should both create and apply, which is what this asserts by watching
 * the PUT.
 */

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({ useUnsavedWorkGuard: () => undefined }));
vi.mock("./crm-nav", () => ({ CrmNav: () => null }));
vi.mock("./merge-wizard-dialog", () => ({ MergeWizardDialog: () => null }));
vi.mock("./crm-custom-field-create-dialog", () => ({ CrmCustomFieldCreateDialog: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = organizationIdSchema.parse("c8000000-0000-4000-8000-000000000001");
const contactId = organizationContactIdSchema.parse("c8000000-0000-4000-8000-000000000002");
const newTagId = "c8000000-0000-4000-8000-0000000000aa";
const createdTag = { id: newTagId, name: "VIP", color: "#00a878", createdAt: "2026-08-16T00:00:00.000Z" };

const contact = {
  id: contactId,
  email: "ada@example.com",
  firstName: "Ada",
  lastName: "Speaker",
  company: null,
  jobTitle: null,
  bioHtml: null,
  linkedinUrl: null,
  twitterUrl: null,
  websiteUrl: null,
  source: "manual" as const,
  customFields: {},
  mergedIntoId: null,
  createdAt: "2026-08-13T18:00:00.000Z",
  updatedAt: "2026-08-13T18:00:00.000Z",
};

const initialHistory = { contact, tags: [], events: [], notes: [], activity: [] };

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

async function typeName(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="New tag name"]');
  if (!input) throw new Error("Tag name input was not rendered");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  refreshMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("creating a tag from a contact's Tags panel", () => {
  it("creates the tag and links it to the open contact in one action", async () => {
    apiMock.mockImplementation((path: string, _schema: unknown, options?: { method?: string }) => {
      if (path === `organizations/${organizationId}/crm/tags` && options?.method === "POST") {
        return Promise.resolve(createdTag);
      }
      if (path === `organizations/${organizationId}/crm/contacts/${contactId}/tags` && options?.method === "PUT") {
        return Promise.resolve({ updated: true });
      }
      if (path === `organizations/${organizationId}/crm/contacts/${contactId}`) {
        // reconcileCommittedCrmWrite → refresh(): the link is now on the row.
        return Promise.resolve({ ...initialHistory, tags: [createdTag] });
      }
      throw new Error(`Unexpected api call: ${options?.method ?? "GET"} ${path}`);
    });

    await act(async () => root.render(
      <ContactDetailView
        organizationId={organizationId}
        initialHistory={initialHistory}
        allTags={[]}
        customFields={[]}
        events={[]}
      />,
    ));

    await act(async () => { buttonNamed("New tag")?.click(); await Promise.resolve(); });
    await typeName("VIP");
    await act(async () => { buttonNamed("Add")?.click(); await Promise.resolve(); });
    // Let the create → attach → reconcile chain settle.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const put = apiMock.mock.calls.find(
      ([path, , options]) => path === `organizations/${organizationId}/crm/contacts/${contactId}/tags` && options?.method === "PUT",
    );
    expect(put).toBeDefined();
    expect(put?.[2]?.body).toEqual({ tagIds: [newTagId] });

    // The chip now reads as applied because the row really carries the tag.
    const chip = [...container.querySelectorAll<HTMLButtonElement>("button.chip")]
      .find((button) => button.textContent?.trim() === "VIP");
    expect(chip?.className).toContain("chip--selected");
  });
});
