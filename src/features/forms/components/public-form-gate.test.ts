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
    expect(markup).toContain("<h1>Share your idea</h1>");
    expect(markup.match(/<h1>/g)).toHaveLength(1);
  });

  it("keeps the event name visible when a logo is also configured", () => {
    const markup = renderToStaticMarkup(createElement(
      PublicFormGate,
      { data: publicForm(null, "/f/event-logo") },
    ));

    expect(markup).toContain("%2Ff%2Fevent-logo");
    expect(markup).toContain('alt="OpenBoard Conf"');
    expect(markup).toContain(">OpenBoard Conf</p>");
  });
});
