import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { eventDtoSchema, organizationIdSchema, trackDtoSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { focusOnNextFrame } from "@/shared/ui/app/focus-on-transition";
import { createAndReconcileOnboardingTrack, createOrPublishOnboardingForm, deleteAndReconcileOnboardingTrack, OnboardingStepHeading, OnboardingWizard, preferredTimeZone, saveOnboardingEvent } from "./onboarding-wizard";

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

Object.assign(globalThis, { React });

describe("onboarding organization access", () => {
  const organizationPage = readFileSync(new URL("../../../app/organizations/[organizationId]/page.tsx", import.meta.url), "utf8");
  const onboardingPage = readFileSync(new URL("../../../app/organizations/[organizationId]/onboarding/page.tsx", import.meta.url), "utf8");
  const wizard = readFileSync(new URL("./onboarding-wizard.tsx", import.meta.url), "utf8");
  const globalCss = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

  it("redirects only organizers and owners into setup", () => {
    expect(organizationPage).toContain('canManageEvents = roleSatisfies(session.role, "organizer")');
    expect(organizationPage).toContain("getActiveOrganizationOnboardingForUser(organizationId, actorUserId)");
    expect(onboardingPage).toContain('requireOrganizationAdmin(organizationId, "organizer")');
    expect(onboardingPage).toContain("getActiveOrganizationOnboardingForUser(organizationId, actorUserId)");
    expect(onboardingPage).toContain("getOrganizationOnboardingForUserByEvent(organizationId, actorUserId, requestedEvent.data)");
  });

  it("resumes only the form explicitly associated with the checkpoint", () => {
    expect(onboardingPage).toContain("progress.formId ? getReservedOnboardingForm(progress.eventId, progress.formId) : null");
    expect(onboardingPage).not.toContain("listForms(");
  });

  it("reserves the stable form ID before creating the form", () => {
    const reservation = wizard.indexOf('body: JSON.stringify({ eventId: event.id, step: "form", formId: formCreateId })');
    const creation = wizard.indexOf("create: () => requestData<BuilderFormLite>");
    expect(reservation).toBeGreaterThan(0);
    expect(reservation).toBeLessThan(creation);
    expect(wizard).toContain("initialState?.formId ?? crypto.randomUUID()");
  });

  it("reveals the optional URL field before focusing a server-side slug error", () => {
    expect(wizard).toContain('if (firstInvalid === "slug" && slugDetailsRef.current) slugDetailsRef.current.open = true');
    expect(wizard).toContain('<details ref={slugDetailsRef} className="onboarding-advanced">');
  });

  it("does not advance while a track mutation is still being saved", () => {
    expect(wizard).toContain("disabled={advancing || addingTrack || Boolean(trackCreateSyncError) || Boolean(removingTrackId) || Boolean(trackSyncError)}");
  });

  it("confirms destructive track removal and blocks progress while server state is ambiguous", () => {
    expect(wizard).toContain('aria-label={`Remove ${track.name}`}');
    expect(wizard).toContain('title={`Remove ${pendingTrackDelete?.name ?? "this track"}?`}');
    expect(wizard).toContain('confirmLabel="Remove track"');
    expect(wizard).toContain("Submissions assigned to this track will become unassigned");
    expect(wizard).toContain("Routing rules that use it will be disabled");
    expect(wizard).toContain("Retry removal");
  });

  it("makes the published handoff previewable and resilient to clipboard failure", () => {
    expect(wizard).toContain('htmlFor="onboarding-public-form-link"');
    expect(wizard).toContain('href={`/events/${event.id}/forms/${createdForm.id}/preview`}');
    expect(wizard).toContain('target="_blank" rel="noreferrer" className="button button-secondary">Preview form');
    expect(wizard).not.toContain('<Link href={formLink} target="_blank" rel="noreferrer" className="button button-secondary">Preview form');
    expect(wizard).toContain('document.execCommand("copy")');
    expect(wizard).toContain("Link selected — press Cmd/Ctrl+C to copy");
    expect(globalCss).toContain(".onboarding-done>.metric-icon{margin:0 auto}");
  });

  it("writes the reload-safe event URL before completing the checkpoint", () => {
    const address = wizard.indexOf("window.history.replaceState(");
    const completion = wizard.indexOf('body: JSON.stringify({ eventId: event.id, step: "complete", formId: finalForm.id })');
    expect(address).toBeGreaterThan(0);
    expect(completion).toBeGreaterThan(address);
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
    expect(html).toContain('class="sr-only">Step 1: Event details</h2>');
    expect(html).toContain('<summary>Customize public URL</summary>');
  });

  it("resumes at tracks with the server-loaded event and tracks", () => {
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
        formId: null,
        form: null,
        publicFormUrl: null,
        formAvailability: null,
      },
    }));

    expect(html).toContain('class="sr-only">Step 2: Tracks</h2>');
    expect(html).toContain("Tracks help organize submissions");
    expect(html).toContain('aria-label="Event details, completed"');
    expect(html).toContain("AI");
    expect(html).toContain('aria-label="Remove AI"');
    expect(html).toContain("Edit event details");
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
        formId: "form-1",
        form: {
          id: "form-1",
          internalName: "Speaker applications",
          status: "open",
          updatedAt: "2026-08-12T00:00:00.000Z",
        },
        publicFormUrl: null,
        formAvailability: null,
      },
    }));

    expect(html).toContain('class="sr-only">Step 3: First form</h2>');
    expect(html).toContain('value="Speaker applications"');
    expect(html).toContain("Finish setup");
    expect(html).toContain("Back to tracks");
  });

  it("restores the completed handoff with direct actions for the exact form", () => {
    const html = renderToStaticMarkup(React.createElement(OnboardingWizard, {
      organizationId,
      organizationName: "Test organization",
      hasExistingEvents: true,
      initialState: {
        step: "complete",
        event,
        tracks: [],
        formId: "form-1",
        form: {
          id: "form-1",
          internalName: "Speaker applications",
          status: "open",
          updatedAt: "2026-08-12T00:00:00.000Z",
        },
        publicFormUrl: "https://preview.example.com/submit/resumable-conf/form-1",
        formAvailability: { open: true, reason: "ok" },
      },
    }));

    expect(html).toContain('class="sr-only">Step 4: Share</h2>');
    expect(html).toContain("Resumable Conf is ready");
    expect(html).toContain("https://preview.example.com/submit/resumable-conf/form-1");
    expect(html).toContain('href="/events/10000000-0000-4000-8000-000000000001/forms/form-1"');
    expect(html).toContain("Manage form");
  });

  it("sends a completed draft straight to the form builder to publish", () => {
    const html = renderToStaticMarkup(React.createElement(OnboardingWizard, {
      organizationId,
      organizationName: "Test organization",
      hasExistingEvents: true,
      initialState: {
        step: "complete",
        event,
        tracks: [],
        formId: "form-1",
        form: {
          id: "form-1",
          internalName: "Speaker applications",
          status: "draft",
          updatedAt: "2026-08-12T00:00:00.000Z",
        },
        publicFormUrl: "https://preview.example.com/submit/resumable-conf/form-1",
        formAvailability: { open: false, reason: "closed_by_admin" },
      },
    }));

    expect(html).toContain("Edit and publish form");
    expect(html).not.toContain("onboarding-link-row");
    expect(html).toContain('class="button button-primary"');
  });

  it("does not call a scheduled form live or expose its share actions", () => {
    const html = renderToStaticMarkup(React.createElement(OnboardingWizard, {
      organizationId,
      organizationName: "Test organization",
      hasExistingEvents: true,
      initialState: {
        step: "complete",
        event,
        tracks: [],
        formId: "form-1",
        form: {
          id: "form-1",
          internalName: "Speaker applications",
          status: "open",
          updatedAt: "2026-08-12T00:00:00.000Z",
          opensAt: "2026-09-01T00:00:00.000Z",
          closesAt: null,
        },
        publicFormUrl: "https://preview.example.com/submit/resumable-conf/form-1",
        formAvailability: { open: false, reason: "not_open_yet" },
      },
    }));

    expect(html).toContain("scheduled but not accepting submissions yet");
    expect(html).toContain("Edit availability");
    expect(html).not.toContain("onboarding-link-row");
    expect(html).not.toContain("Preview form");
  });

  it("renders and focuses the new heading after a step replacement", () => {
    const html = renderToStaticMarkup(React.createElement(OnboardingStepHeading, {
      step: 2,
      headingRef: React.createRef<HTMLHeadingElement>(),
    }));
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Step 2: Tracks");

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

describe("onboarding event correction", () => {
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
    rowVersion: 4,
  });

  it("updates the existing event with its current row version instead of creating another", async () => {
    const create = vi.fn();
    const update = vi.fn().mockResolvedValue({ ...event, name: "Corrected Conf", rowVersion: 5 });

    await expect(saveOnboardingEvent({ existing: event, create, update }))
      .resolves.toMatchObject({ name: "Corrected Conf", rowVersion: 5 });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(event.id, 4);
  });

  it("uses the retry-safe create path before an event exists", async () => {
    const create = vi.fn().mockResolvedValue(event);
    const update = vi.fn();

    await expect(saveOnboardingEvent({ existing: null, create, update })).resolves.toBe(event);
    expect(create).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("OnboardingWizard first-use defaults", () => {
  it("uses the browser timezone when supported and otherwise falls back safely", () => {
    const supported = ["Europe/London", "America/Los_Angeles"];
    expect(preferredTimeZone("Europe/London", supported)).toBe("Europe/London");
    expect(preferredTimeZone("UTC", supported)).toBe("UTC");
    expect(preferredTimeZone("Not/A_Zone", supported)).toBe("America/Los_Angeles");
    expect(preferredTimeZone(undefined, supported)).toBe("America/Los_Angeles");
  });
});

describe("onboarding track deletion recovery", () => {
  const track = trackDtoSchema.parse({
    id: "20000000-0000-4000-8000-000000000001",
    name: "AI",
    color: "#6958d7",
    description: null,
    sortOrder: 0,
  });

  it("does not perform an unnecessary reconciliation after a confirmed delete", async () => {
    const list = vi.fn(async () => [track]);
    await expect(deleteAndReconcileOnboardingTrack({ trackId: track.id, remove: vi.fn(async () => undefined), list }))
      .resolves.toEqual({ status: "removed" });
    expect(list).not.toHaveBeenCalled();
  });

  it("replays an interrupted delete before reading and recognizes completion", async () => {
    const remove = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(undefined);
    const list = vi.fn(async () => [track]);
    await expect(deleteAndReconcileOnboardingTrack({
      trackId: track.id,
      remove,
      list,
    })).resolves.toEqual({ status: "removed" });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(list).not.toHaveBeenCalled();
  });

  it("restores the authoritative list only after a definitive server refusal", async () => {
    const error = new AppError("CONFLICT", "delete refused");
    await expect(deleteAndReconcileOnboardingTrack({
      trackId: track.id,
      remove: vi.fn(async () => { throw error; }),
      list: vi.fn(async () => [track]),
    })).resolves.toEqual({ status: "restored", tracks: [track], error });
  });

  it("accepts final absence after both delete responses were lost", async () => {
    const error = new Error("response lost");
    await expect(deleteAndReconcileOnboardingTrack({
      trackId: track.id,
      remove: vi.fn(async () => { throw error; }),
      list: vi.fn(async () => []),
    })).resolves.toEqual({ status: "removed", tracks: [] });
  });

  it("does not restore a present row from a read that may have overtaken interrupted deletes", async () => {
    const error = new Error("response lost");
    await expect(deleteAndReconcileOnboardingTrack({
      trackId: track.id,
      remove: vi.fn(async () => { throw error; }),
      list: vi.fn(async () => [track]),
    })).resolves.toEqual({ status: "unconfirmed", error });
  });

  it("keeps progress blocked when both delete responses and reconciliation fail", async () => {
    const error = new Error("response lost");
    await expect(deleteAndReconcileOnboardingTrack({
      trackId: track.id,
      remove: vi.fn(async () => { throw error; }),
      list: vi.fn(async () => { throw new Error("offline"); }),
    })).resolves.toEqual({ status: "unconfirmed", error });
  });
});

describe("onboarding track creation recovery", () => {
  const request = { id: "20000000-0000-4000-8000-000000000002", name: "AI", color: "#6958d7" };
  const track = trackDtoSchema.parse({ ...request, description: null, sortOrder: 0 });

  it("does not reconcile after a confirmed create", async () => {
    const list = vi.fn(async () => [track]);
    await expect(createAndReconcileOnboardingTrack({ request, create: vi.fn(async () => track), list }))
      .resolves.toEqual({ status: "added", track });
    expect(list).not.toHaveBeenCalled();
  });

  it("replays a lost response with the same stable request id", async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(track);
    await expect(createAndReconcileOnboardingTrack({ request, create, list: vi.fn() }))
      .resolves.toEqual({ status: "added", track });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("recovers the exact committed row after both create responses are lost", async () => {
    const error = new Error("response lost");
    await expect(createAndReconcileOnboardingTrack({
      request,
      create: vi.fn(async () => { throw error; }),
      list: vi.fn(async () => [track]),
    })).resolves.toEqual({ status: "added", track });
  });

  it("blocks progress when neither replay nor reconciliation establishes the result", async () => {
    const error = new Error("response lost");
    await expect(createAndReconcileOnboardingTrack({
      request,
      create: vi.fn(async () => { throw error; }),
      list: vi.fn(async () => []),
    })).resolves.toEqual({ status: "unconfirmed", error });
  });

  it("surfaces a definitive server refusal without retrying", async () => {
    const error = new AppError("VALIDATION", "name rejected");
    const create = vi.fn(async () => { throw error; });
    await expect(createAndReconcileOnboardingTrack({ request, create, list: vi.fn() }))
      .resolves.toEqual({ status: "refused", error });
    expect(create).toHaveBeenCalledOnce();
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
    const onReady = vi.fn();
    const reconcile = vi.fn(async () => draft);

    await expect(createOrPublishOnboardingForm({ existing: null, publishNow: false, create, reconcile, publish: vi.fn(), onReady }))
      .rejects.toThrow("response lost");
    await expect(createOrPublishOnboardingForm({ existing: null, publishNow: false, create, reconcile, publish: vi.fn(), onReady }))
      .resolves.toEqual(draft);
    expect(create).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith(draft);
  });

  it("retains a created draft and retries only publication", async () => {
    const draft = { id: "form-1", status: "draft", updatedAt: "2026-08-11T00:00:00.000Z" };
    const open = { ...draft, status: "open", updatedAt: "2026-08-11T00:00:01.000Z" };
    const create = vi.fn(async () => draft);
    const publish = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(open);
    const reconcile = vi.fn(async () => draft);
    const onReady = vi.fn();

    await expect(createOrPublishOnboardingForm({ existing: null, publishNow: true, create, reconcile, publish, onReady })).rejects.toThrow("offline");
    expect(onReady).toHaveBeenCalledWith(draft);
    await expect(createOrPublishOnboardingForm({ existing: draft, publishNow: true, create, reconcile, publish, onReady })).resolves.toEqual(open);
    expect(create).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledTimes(2);
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
      onReady: vi.fn(),
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
    const onReady = vi.fn();

    await expect(createOrPublishOnboardingForm({
      existing: null,
      publishNow: true,
      create,
      reconcile,
      publish,
      onReady,
    })).rejects.toThrow("response lost");

    await expect(createOrPublishOnboardingForm({
      existing: draft,
      publishNow: false,
      create,
      reconcile,
      publish,
      onReady,
    })).resolves.toEqual(open);
    expect(create).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
});
