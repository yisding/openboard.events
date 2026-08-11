import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EventForm } from "./event-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

Object.assign(globalThis, { React });

describe("EventForm accessibility", () => {
  it("uses a keyboard-submittable form with native required controls and stable associations", () => {
    const html = renderToStaticMarkup(React.createElement(EventForm));

    expect(html).toContain('<form class="form-stack"');
    expect(html).toContain('id="event-name"');
    expect(html).toContain('name="name"');
    expect(html).toContain("required");
    expect(html).toContain('aria-describedby="event-slug-help"');
    expect(html).toContain('id="event-slug-help"');
    expect(html).toContain('id="event-starts-at"');
    expect(html).toContain('id="event-ends-at"');
    expect(html).toContain('type="submit"');
  });
});
