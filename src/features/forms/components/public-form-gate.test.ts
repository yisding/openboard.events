import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicForm } from "@/features/forms";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { PublicFormGate } from "./public-form-gate";

function publicForm(backgroundUrl: string | null): PublicForm {
  return {
    event: {
      id: "event-1",
      name: "OpenBoard Conf",
      slug: "openboard-conf",
      timezone: "UTC",
      logoUrl: null,
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
