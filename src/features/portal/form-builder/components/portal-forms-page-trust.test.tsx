import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BuilderEvent, FormListRow } from "@/features/forms";
import { claimPortalFormRowAction, PortalFormsPage, type PortalFormRowAction } from "./portal-forms-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

Object.assign(globalThis, { React });

const event: BuilderEvent = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Trustworthy Forms Conf",
  slug: "trustworthy-forms-conf",
  timezone: "America/Los_Angeles",
  submissionCapPerUser: 3,
};

const form = {
  id: "10000000-0000-4000-8000-000000000101",
  internalName: "Speaker profile update",
  externalTitle: "Update your profile",
  status: "draft",
  availability: "draft",
  kind: "abstract",
  targetType: "contact",
  collectParticipants: false,
  opensAt: null,
  closesAt: null,
  createdAt: "2026-08-12T12:00:00.000Z",
  submissionCount: 0,
  draftCount: 0,
  pendingCount: 0,
  currentVersion: 1,
} as FormListRow;

describe("portal form management trust", () => {
  it("names every icon-only row action with the form it affects", () => {
    const html = renderToStaticMarkup(<PortalFormsPage event={event} initialForms={[form]} />);

    expect(html).toContain('aria-label="Duplicate Speaker profile update"');
    expect(html).toContain('aria-label="Delete Speaker profile update"');
    expect(html).toContain('title="Duplicate Speaker profile update"');
    expect(html).toContain('title="Delete Speaker profile update"');
  });

  it("uses stable unknown-outcome recovery and locks the exact retry payload", () => {
    const source = readFileSync(new URL("./portal-forms-page.tsx", import.meta.url), "utf8");

    expect(source).toContain("createStableCreateRequestId()");
    expect(source).toContain("requestFormCreate<BuilderForm>");
    expect(source).toContain("createRequestId.current.payload(undefined");
    expect(source).toContain("setRecoveryRequired(outcomeUnknown)");
    expect(source.match(/disabled=\{busy \|\| recoveryRequired\}/gu)).toHaveLength(3);
    expect(source).toContain("Retry form creation");
    expect(source).toContain("Retry with the same details before making changes.");
  });

  it("uses the accessible confirmation primitive and per-row action gates", () => {
    const source = readFileSync(new URL("./portal-forms-page.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("window.confirm");
    expect(source).toContain("<ConfirmDialog");
    expect(source).toContain('confirmLabel="Delete form"');
    expect(source).toContain("claimPortalFormRowAction(rowActionsRef.current, formId, action)");
    expect(source).toContain('claimRowAction(form.id, "duplicate")');
    expect(source).toContain('claimRowAction(form.id, "delete")');
    expect(source.match(/disabled=\{Boolean\(rowActions\[form\.id\]\)\}/gu)).toHaveLength(2);
  });

  it("rejects a repeated action on the same row while allowing another row", () => {
    const actions = new Map<string, PortalFormRowAction>();

    expect(claimPortalFormRowAction(actions, "form-1", "duplicate")).toBe(true);
    expect(claimPortalFormRowAction(actions, "form-1", "delete")).toBe(false);
    expect(claimPortalFormRowAction(actions, "form-2", "delete")).toBe(true);
    expect(actions).toEqual(new Map([
      ["form-1", "duplicate"],
      ["form-2", "delete"],
    ]));
  });

  it("announces every create, duplicate, and delete failure as an error", () => {
    const source = readFileSync(new URL("./portal-forms-page.tsx", import.meta.url), "utf8");
    const errorKinds = source.match(/\{ kind: "error" \}/gu) ?? [];

    expect(errorKinds).toHaveLength(3);
  });
});
