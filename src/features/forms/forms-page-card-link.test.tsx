import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formIdSchema } from "@/shared/contracts";
import type { BuilderEvent, FormListRow } from "./builder-types";
import { FormsPage } from "./forms-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

Object.assign(globalThis, { React });

const event: BuilderEvent = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "AI Engineer World's Fair",
  slug: "ai-engineer-world-s-fair",
  timezone: "America/Los_Angeles",
  submissionCapPerUser: 3,
};

const liveForm: FormListRow = {
  id: formIdSchema.parse("10000000-0000-4000-8000-000000000101"),
  internalName: "Speak at AI Engineer World's Fair",
  externalTitle: "Call for speakers",
  status: "open",
  availability: "live",
  kind: "abstract",
  targetType: "submission",
  collectParticipants: true,
  opensAt: "2026-07-01T12:00:00.000Z",
  closesAt: "2026-09-01T12:00:00.000Z",
  createdAt: "2026-07-01T12:00:00.000Z",
  submissionCount: 24,
  draftCount: 2,
  pendingCount: 0,
  currentVersion: 3,
};

/**
 * The tour's `call.open-form` step spotlights `.form-list-card` and tells the
 * player to open the call, so the card's own surface has to lead somewhere —
 * and it has to be the builder route that step's objective watches for.
 */
describe("form list card surface", () => {
  it("names the form as a link to its builder, the route the tour's open-form objective waits on", () => {
    const html = renderToStaticMarkup(<FormsPage event={event} initialForms={[liveForm]} />);
    const titleLink = html.match(/<h2>(<a[^>]*>)/u)?.[1];

    expect(titleLink, "the card's heading should open something").toBeDefined();
    expect(titleLink).toContain('class="form-list-title-link"');
    expect(titleLink).toContain(`href="/events/${event.id}/forms/${liveForm.id}"`);
  });

  it("stretches that link over the whole card while keeping the row actions clickable", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

    // The card is the stretched link's containing block, the pseudo-element
    // covers it, and the actions row is lifted back out from under it.
    expect(css).toMatch(/\.form-list-card \{[^}]*position: relative;/u);
    expect(css).toMatch(/\.form-list-title-link::after \{[^}]*inset: 0;/u);
    expect(css).toMatch(/\.form-list-actions \{[^}]*position: relative;[^}]*z-index: 1;/u);
  });
});
