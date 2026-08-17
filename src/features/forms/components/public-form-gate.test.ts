import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicForm } from "@/features/forms";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { PublicFormGate } from "./public-form-gate";

function publicForm(backgroundUrl: string | null, logoUrl: string | null = null): PublicForm {
  return {
    event: {
      id: "event-1",
      name: "OpenBoard Conf",
      slug: "openboard-conf",
      timezone: "UTC",
      logoUrl,
      backgroundUrl,
    },
    form: {
      id: "01900000-0000-7000-8000-000000000001" as PublicForm["form"]["id"],
      externalTitle: "Call for speakers",
      pageHeading: "Share your idea",
      showWelcome: false,
      welcomeHtml: null,
      collectParticipants: true,
      participantRoles: [],
      successHtml: null,
      autoRedirectToPortal: false,
      opensAt: null,
      closesAt: null,
      effectiveLimit: 2,
    },
    snapshot: GOLDEN_SNAPSHOT,
    openState: { open: true, reason: "ok" },
  };
}

describe("PublicFormGate event background", () => {
  it("renders a configured event image as decorative same-origin branding", () => {
    const markup = renderToStaticMarkup(createElement(
      PublicFormGate,
      { data: publicForm("/f/event-background") },
      createElement("p", null, "Form body"),
    ));

    expect(markup).toContain('src="/f/event-background"');
    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("Form body");
  });

  it("keeps the no-background fallback free of decorative image markup", () => {
    const markup = renderToStaticMarkup(createElement(
      PublicFormGate,
      { data: publicForm(null) },
      createElement("p", null, "Form body"),
    ));

    expect(markup).not.toContain("<img");
    expect(markup).toContain("Form body");
  });
});

describe("PublicFormGate event identity", () => {
  it("names an unbranded event without replacing the organizer's welcome heading", () => {
    const markup = renderToStaticMarkup(createElement(PublicFormGate, { data: publicForm(null) }));

    expect(markup).toContain("OpenBoard Conf");
    expect(markup).toContain('href="/e/openboard-conf/agenda"');
    expect(markup).toContain("Event site");
    expect(markup).toContain("<h1>Share your idea</h1>");
    expect(markup.match(/<h1>/g)).toHaveLength(1);
  });

  it("keeps the event name visible when a logo is also configured", () => {
    const markup = renderToStaticMarkup(createElement(
      PublicFormGate,
      { data: publicForm(null, "/f/event-logo") },
    ));

    expect(markup).toContain("%2Ff%2Fevent-logo");
    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain(">OpenBoard Conf</b>");
  });

  it("renders submission metadata as real label-value pairs", () => {
    const data = publicForm(null);
    data.form.closesAt = "2026-10-15T20:00:00.000Z";
    const markup = renderToStaticMarkup(createElement(PublicFormGate, { data }));

    expect(markup).toContain("<dl");
    expect(markup).toContain("<dt>Submissions close</dt>");
    expect(markup).toContain("<dt>Submission limit</dt>");
    expect(markup).toContain("<dd>2 per speaker</dd>");
  });
});

describe("PublicFormGate closed state", () => {
  // The programme link is the only way out of a dead-end page, so it has to
  // land inside .cfp-closed — the one selector in globals.css that gives an
  // inline link accent color and an underline instead of invisible inherited ink.
  it("gives the closed CFP's escape hatch a real link, reachable inside the styled section", () => {
    const data = publicForm(null);
    data.openState = { open: false, reason: "closed_by_date" };
    const markup = renderToStaticMarkup(createElement(PublicFormGate, { data }));

    expect(markup).toContain('<section class="cfp-closed">');
    expect(markup).toMatch(/<section class="cfp-closed">[\s\S]*<a href="\/e\/openboard-conf\/agenda">See the programme<\/a>[\s\S]*<\/section>/);
  });

  it("gives the not-open-yet CFP the same styled escape hatch", () => {
    const data = publicForm(null);
    data.openState = { open: false, reason: "not_open_yet" };
    const markup = renderToStaticMarkup(createElement(PublicFormGate, { data }));

    expect(markup).toContain('<section class="cfp-closed">');
    expect(markup).toMatch(/<section class="cfp-closed">[\s\S]*<a href="\/e\/openboard-conf\/agenda">See the programme<\/a>[\s\S]*<\/section>/);
  });
});
