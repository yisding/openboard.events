import { existsSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import RootError from "@/app/error";
import GlobalError from "@/app/global-error";
import PublicEventError from "@/app/e/[eventSlug]/error";
import EmbedError from "@/app/embed/[eventSlug]/error";
import PortalError from "@/app/portal/error";
import SubmitError from "@/app/submit/[eventSlug]/error";

vi.mock("next/navigation", () => ({ usePathname: () => "/submit/openboard-summit/form" }));
Object.assign(globalThis, { React });

const props = { error: new Error("render failed"), reset: () => undefined };

describe("public error boundaries", () => {
  it("provides branded root and root-layout recovery", () => {
    const root = renderToStaticMarkup(<RootError {...props} />);
    const global = renderToStaticMarkup(<GlobalError {...props} />);

    expect(root).toContain("openboard");
    expect(root).toContain('class="brand brand-dark"');
    expect(root).toContain("Try again");
    expect(root).toContain('href="/"');
    expect(global).toContain('<html lang="en"');
    expect(global).toContain("Openboard needs a fresh start");
    expect(global).toContain("Try again");
  });

  it("gives submitters a retry and an event escape route", () => {
    const html = renderToStaticMarkup(<SubmitError {...props} />);

    expect(html).toContain("We couldn&#x27;t open this submission form");
    expect(html).toContain("Try again");
    expect(html).toContain('href="/e/openboard-summit/agenda"');
  });

  it("gives speakers and attendees audience-specific recovery copy", () => {
    const portal = renderToStaticMarkup(<PortalError {...props} />);
    const event = renderToStaticMarkup(<PublicEventError {...props} />);

    expect(existsSync(new URL("../../../app/portal/[eventSlug]/error.tsx", import.meta.url))).toBe(false);
    expect(portal).toContain("The speaker portal didn&#x27;t load");
    expect(portal).toContain("profile, submissions, and completed tasks are still safe");
    expect(portal).toContain('href="/e/openboard-summit/agenda"');
    expect(event).toContain("This event page didn&#x27;t load");
    expect(event).toContain("published program is temporarily unavailable");
    expect(event).toContain('href="/e/openboard-summit/agenda"');
  });

  it("lets a failed embed retry in place or escape to the full event", () => {
    const html = renderToStaticMarkup(<EmbedError {...props} />);

    expect(html).toContain("This embedded program didn&#x27;t load");
    expect(html).toContain("Try again");
    expect(html).toContain('href="/e/openboard-summit/agenda"');
    expect(html).toContain('target="_top"');
  });
});
