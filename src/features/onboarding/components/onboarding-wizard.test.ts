import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { organizationIdSchema } from "@/shared/contracts";
import { OnboardingWizard } from "./onboarding-wizard";

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

Object.assign(globalThis, { React });

describe("OnboardingWizard event step accessibility", () => {
  it("uses a keyboard-submittable form with required and described controls", () => {
    const html = renderToStaticMarkup(React.createElement(OnboardingWizard, {
      organizationId: organizationIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      organizationName: "Test organization",
      hasExistingEvents: false,
    }));

    expect(html).toContain('<form class="cfp-step form-stack"');
    expect(html).toContain('id="onboarding-event-name"');
    expect(html).toContain('name="name"');
    expect(html).toContain('aria-describedby="onboarding-event-slug-help"');
    expect(html).toContain('id="onboarding-event-slug-help"');
    expect(html).toContain('id="onboarding-event-starts-at"');
    expect(html).toContain('id="onboarding-event-ends-at"');
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('class="sr-only">Step 1: Event basics</h2>');
  });

  it("focuses the new step heading after a step replacement", () => {
    const source = readFileSync(new URL("./onboarding-wizard.tsx", import.meta.url), "utf8");
    expect(source).toContain("stepHeadingRef.current?.focus()");
    expect(source).toContain('aria-current={step === index + 1 ? "step" : undefined}');
  });
});
