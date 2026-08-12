import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AdminShell } from "./admin-shell";
import { eventIdSchema } from "@/shared/contracts";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  usePathname: () => "/events/00000000-0000-4000-8000-000000000001/dashboard",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/features/shell/components/command-palette", () => ({
  CommandPalette: () => <button type="button">Search</button>,
}));

vi.mock("@/features/events/components/event-switcher", () => ({
  EventSwitcher: () => <button type="button">Event</button>,
}));

vi.mock("@/features/auth/components/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));

Object.assign(globalThis, { React });

const ADMIN_CHILD_VIEWS = [
  "../agenda/components/agenda-page.tsx",
  "../comms/components/comms-admin-page.tsx",
  "../dashboard/components/DashboardTabs.tsx",
  "../events/components/settings-shell.tsx",
  "../forms/form-builder.tsx",
  "../portal/components/speakers-admin/speaker-detail-view.tsx",
  "../portal/components/speakers-admin/speakers-admin-view.tsx",
  "../portal/deliverables/components/files-admin-view.tsx",
  "../portal/form-builder/components/portal-form-builder.tsx",
  "../portal/resources/components/resource-pages-admin-view.tsx",
  "../portal/tasks-admin/components/tasks-admin-view.tsx",
  "../public/embeds-admin-page.tsx",
  "../submissions/components/abstracts-view.tsx",
  "../submissions/evaluation/components/plans-view.tsx",
  "../submissions/evaluation/components/review-queue-view.tsx",
] as const;

function cssRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("admin shell skip navigation", () => {
  it("renders a focusable skip target inside the shell's single main landmark", () => {
    const eventId = eventIdSchema.parse("00000000-0000-4000-8000-000000000001");
    const html = renderToStaticMarkup(
      <AdminShell
        eventId={eventId}
        role="organizer"
        event={{ id: eventId, slug: "summit", name: "Summit", shortName: "SUM" }}
      >
        <section aria-label="Dashboard">Dashboard content</section>
      </AdminShell>,
    );

    expect(html).toContain('<a class="admin-skip-link" href="#admin-content">Skip to main content</a>');
    expect(html).toContain('<main class="app-main"');
    expect(html).toContain('id="admin-content" class="app-content" tabindex="-1"');
    expect(html.match(/<main(?:\s|>)/g)).toHaveLength(1);
    expect(html.indexOf("admin-skip-link")).toBeLessThan(html.indexOf("admin-navigation"));
  });

  it("keeps the link off-screen until keyboard focus reveals it above the shell", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const hidden = cssRule(css, ".admin-skip-link");
    const visible = cssRule(css, ".admin-skip-link:focus-visible");

    expect(hidden).toMatch(/position:\s*fixed/);
    expect(hidden).toMatch(/z-index:\s*40/);
    expect(hidden).toMatch(/transform:\s*translateY\(calc\(-100% - 16px\)\)/);
    expect(visible).toMatch(/transform:\s*translateY\(0\)/);
  });
});

describe("admin main landmark ownership", () => {
  it.each(ADMIN_CHILD_VIEWS)("does not nest a main landmark in %s", (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    expect(source).not.toMatch(/<\/?main(?:\s|>)/);
  });
});
