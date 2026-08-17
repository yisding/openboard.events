import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import OrganizationsError from "@/app/organizations/error";
import OrganizationError from "@/app/organizations/[organizationId]/error";
import AccountError from "@/app/account/error";
import OrganizationsLoading from "@/app/organizations/loading";
import OrganizationLoading from "@/app/organizations/[organizationId]/loading";
import AccountLoading from "@/app/account/loading";

const nav = vi.hoisted(() => ({ pathname: "/organizations" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

Object.assign(globalThis, { React });

const props = { error: new Error("read failed"), reset: () => undefined };

function renderAt(pathname: string, node: React.ReactElement) {
  nav.pathname = pathname;
  return renderToStaticMarkup(node);
}

describe("organization and account route recovery states", () => {
  it("keeps a failing admin surface inside the admin app instead of the public shell", () => {
    const chooser = renderAt("/organizations", <OrganizationsError {...props} />);
    const account = renderAt("/account/sessions", <AccountError {...props} />);

    for (const html of [chooser, account]) {
      expect(html).toContain('role="alert"');
      expect(html).toContain("Try again");
      expect(html).toContain('href="/events"');
      expect(html).toContain("Back to events");
      // `app/error.tsx` — the boundary these used to fall through to — offers
      // the marketing home instead, which is the whole bug.
      expect(html).not.toContain("Openboard home");
    }
    expect(chooser).toContain("We couldn&#x27;t load your organizations");
    expect(account).toContain("still signed in");
  });

  it("offers an organization sub-page the way back to its own home", () => {
    const team = renderAt("/organizations/org_1/team", <OrganizationError {...props} />);
    const home = renderAt("/organizations/org_1", <OrganizationError {...props} />);

    expect(team).toContain('href="/organizations/org_1"');
    expect(team).toContain("Organization home");
    expect(home).toContain('href="/events"');
    expect(home).toContain("Back to events");
  });

  it("does not open a second landmark or a second viewport under a layout that owns both", () => {
    const nested = renderAt("/organizations/org_1/billing", <OrganizationError {...props} />);
    const topLevel = renderAt("/organizations", <OrganizationsError {...props} />);

    // `organizations/[organizationId]` and `account` render inside a layout
    // that already draws `<main class="events-index">`; `/organizations` has no
    // layout at all, so its boundary is the page.
    expect(nested).toContain("route-error-state--inline");
    expect(nested).not.toContain("<main");
    expect(topLevel).toContain("<main");
    expect(topLevel).not.toContain("route-error-state--inline");
  });

  it("announces every new loading boundary and hides its decorative skeletons", () => {
    const hub = renderToStaticMarkup(<OrganizationsLoading />);
    const organization = renderToStaticMarkup(<OrganizationLoading />);
    const account = renderToStaticMarkup(<AccountLoading />);

    expect(hub).toContain('<p class="sr-only" role="status">Loading your organizations…</p>');
    expect(organization).toContain('<p class="sr-only" role="status">Loading this organization…</p>');
    expect(account).toContain('<p class="sr-only" role="status">Loading your account…</p>');
    for (const html of [hub, organization, account]) {
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('class="route-workspace-loading__grid" aria-hidden="true"');
    }
  });

  it("draws the shell chrome in the boundary that stands in for the organization layout", () => {
    const hub = renderToStaticMarkup(<OrganizationsLoading />);

    // `/organizations` has no layout, so this fallback replaces the branded
    // header too — a blank canvas would be a worse first paint than none.
    expect(hub).toContain('class="events-index-header"');
    expect(hub).toContain('class="brand brand-dark"');
    expect(hub).toContain('href="/events"');
    // The pages underneath keep their layout, so their fallback is body-only.
    expect(renderToStaticMarkup(<OrganizationLoading />)).not.toContain("events-index-header");
  });
});
