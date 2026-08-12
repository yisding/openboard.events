import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { eventDtoSchema, organizationIdSchema, trackDtoSchema } from "@/shared/contracts";
import { focusOnNextFrame } from "@/shared/ui/app/focus-on-transition";
import { createOrPublishOnboardingForm, OnboardingStepHeading, OnboardingWizard } from "./onboarding-wizard";

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

Object.assign(globalThis, { React });

describe("onboarding organization access", () => {
  const organizationPage = readFileSync(new URL("../../../app/organizations/[organizationId]/page.tsx", import.meta.url), "utf8");
  const onboardingPage = readFileSync(new URL("../../../app/organizations/[organizationId]/onboarding/page.tsx", import.meta.url), "utf8");

  it("redirects only organizers and owners into setup", () => {
    expect(organizationPage).toContain('canManageEvents = roleSatisfies(session.role, "organizer")');
    expect(organizationPage).toContain("if (canManageEvents && (eventRows.length === 0 || progress))");
    expect(onboardingPage).toContain('requireOrganizationAdmin(organizationId, "organizer")');
  });
});

describe("OnboardingWizard event step accessibility", () => {
  const organizationId = organizationIdSchema.parse("00000000-0000-4000-8000-000000000001");
  const event = eventDtoSchema.parse({
    id: "10000000-0000-4000-8000-000000000001",
    name: "Resumable Conf",
    slug: "resumable-conf",
    eventType: "conference",
    websiteUrl: null,
    location: null,
    physicalAddress: null,
    timezone: "America/Los_Angeles",
    startsAt: "2026-09-15T16:00:00.000Z",
    endsAt: "2026-09-17T01:00:00.000Z",
    theme: null,
    logoFileId: null,
    backgroundFileId: null,
    submissionCapPerUser: 3,
    rowVersion: 1,
  });

  it("uses a keyboard-submittable form with required and described controls", () => {
    const html = renderToStaticMarkup(React.createElement(OnboardingWizard, {
      organizationId,
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

  it("resumes at vocabulary with the server-loaded event and tracks", () => {
    const html = renderToStaticMarkup(React.createElement(OnboardingWizard, {
      organizationId,
      organizationName: "Test organization",
      hasExistingEvents: true,
      initialState: {
        step: "vocabulary",
        event,
        tracks: [trackDtoSchema.parse({
          id: "20000000-0000-4000-8000-000000000001",
          name: "AI",
          color: "#6958d7",
          description: null,
          sortOrder: 0,
        })],
        form: null,
      },
    }));

    expect(html).toContain('class="sr-only">Step 2: Vocabulary</h2>');
    expect(html).toContain("Add a few tracks");
    expect(html).toContain("AI");
    expect(html).not.toContain('id="onboarding-event-name"');
  });

  it("resumes at the form and can finish an already-published form", () => {
    const html = renderToStaticMarkup(React.createElement(OnboardingWizard, {
      organizationId,
      organizationName: "Test organization",
      hasExistingEvents: true,
      initialState: {
        step: "form",
        event,
        tracks: [],
        form: {
          id: "form-1",
          internalName: "Speaker applications",
          status: "open",
          updatedAt: "2026-08-12T00:00:00.000Z",
        },
      },
    }));

    expect(html).toContain('class="sr-only">Step 3: First form</h2>');
    expect(html).toContain('value="Speaker applications"');
    expect(html).toContain("Finish setup");
  });

  it("renders and focuses the new heading after a step replacement", () => {
    const html = renderToStaticMarkup(React.createElement(OnboardingStepHeading, {
      step: 2,
      headingRef: React.createRef<HTMLHeadingElement>(),
    }));
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Step 2: Vocabulary");

    const focus = vi.fn();
    const scheduler = {
      requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => { callback(0); return 23; }),
      cancelAnimationFrame: vi.fn(),
    };
    const cancel = focusOnNextFrame({ current: { focus } }, scheduler);
    expect(focus).toHaveBeenCalledOnce();
    cancel();
    expect(scheduler.cancelAnimationFrame).toHaveBeenCalledWith(23);
  });
});

describe("onboarding form publication recovery", () => {
  it("recovers a committed form create when the stable-id replay returns the original draft", async () => {
    const draft = { id: "stable-form", status: "draft", updatedAt: "2026-08-11T00:00:00.000Z" };
    let committed = false;
    const create = vi.fn(async () => {
      if (!committed) {
        committed = true;
        throw new Error("response lost");
      }
      return draft;
    });
    const onCreated = vi.fn();
    const reconcile = vi.fn(async () => draft);

    await expect(createOrPublishOnboardingForm({ existing: null, publishNow: false, create, reconcile, publish: vi.fn(), onCreated }))
      .rejects.toThrow("response lost");
    await expect(createOrPublishOnboardingForm({ existing: null, publishNow: false, create, reconcile, publish: vi.fn(), onCreated }))
      .resolves.toEqual(draft);
    expect(create).toHaveBeenCalledTimes(2);
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledWith(draft);
  });

  it("retains a created draft and retries only publication", async () => {
    const draft = { id: "form-1", status: "draft", updatedAt: "2026-08-11T00:00:00.000Z" };
    const open = { ...draft, status: "open", updatedAt: "2026-08-11T00:00:01.000Z" };
    const create = vi.fn(async () => draft);
    const publish = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(open);
    const reconcile = vi.fn(async () => draft);
    const onCreated = vi.fn();

    await expect(createOrPublishOnboardingForm({ existing: null, publishNow: true, create, reconcile, publish, onCreated })).rejects.toThrow("offline");
    expect(onCreated).toHaveBeenCalledWith(draft);
    await expect(createOrPublishOnboardingForm({ existing: draft, publishNow: true, create, reconcile, publish, onCreated })).resolves.toEqual(open);
    expect(create).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it("recognizes a publish that committed when its response was lost", async () => {
    const draft = { id: "form-1", status: "draft", updatedAt: "2026-08-11T00:00:00.000Z" };
    const open = { ...draft, status: "open", updatedAt: "2026-08-11T00:00:01.000Z" };
    let serverForm = draft;
    const create = vi.fn(async () => draft);
    const publish = vi.fn(async () => {
      serverForm = open;
      throw new Error("response lost");
    });
    const reconcile = vi.fn(async () => serverForm);

    await expect(createOrPublishOnboardingForm({
      existing: null,
      publishNow: true,
      create,
      reconcile,
      publish,
      onCreated: vi.fn(),
    })).resolves.toEqual(open);
    expect(publish).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it("reconciles an ambiguous prior publication before continuing with publish unchecked", async () => {
    const draft = { id: "form-1", status: "draft", updatedAt: "2026-08-11T00:00:00.000Z" };
    const open = { ...draft, status: "open", updatedAt: "2026-08-11T00:00:01.000Z" };
    const create = vi.fn(async () => draft);
    const publish = vi.fn(async () => { throw new Error("response lost"); });
    const reconcile = vi.fn()
      .mockRejectedValueOnce(new Error("still offline"))
      .mockResolvedValueOnce(open);
    const onCreated = vi.fn();

    await expect(createOrPublishOnboardingForm({
      existing: null,
      publishNow: true,
      create,
      reconcile,
      publish,
      onCreated,
    })).rejects.toThrow("response lost");

    await expect(createOrPublishOnboardingForm({
      existing: draft,
      publishNow: false,
      create,
      reconcile,
      publish,
      onCreated,
    })).resolves.toEqual(open);
    expect(create).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});
