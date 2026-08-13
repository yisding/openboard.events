/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { organizationIdSchema } from "@/shared/contracts";
import { OnboardingWizard } from "./onboarding-wizard";

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const props = {
  organizationId: organizationIdSchema.parse("00000000-0000-4000-8000-000000000001"),
  organizationName: "Test organization",
  hasExistingEvents: false,
};

describe("OnboardingWizard hydration readiness", () => {
  it("keeps controlled event fields disabled until hydration and then enables them", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<OnboardingWizard {...props} />);
    document.body.append(container);
    const form = container.querySelector<HTMLFormElement>("form");
    const controls = Array.from(container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
      "#onboarding-event-name, #onboarding-event-type, #onboarding-event-timezone, #onboarding-event-starts-at, #onboarding-event-ends-at, button[type='submit']",
    ));
    let root: Root | undefined;

    try {
      expect(form?.getAttribute("aria-busy")).toBe("true");
      expect(controls).toHaveLength(6);
      expect(controls.every((control) => control.disabled)).toBe(true);

      await act(async () => {
        root = hydrateRoot(container, <OnboardingWizard {...props} />);
        await Promise.resolve();
      });

      expect(form?.getAttribute("aria-busy")).toBe("false");
      expect(controls.every((control) => !control.disabled)).toBe(true);
    } finally {
      if (root) await act(async () => root?.unmount());
      container.remove();
    }
  });
});
