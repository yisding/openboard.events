import { describe, expect, it } from "vitest";
import { TEMPLATE_KEYS } from "@/shared/contracts";
import { arcSteps, type TourRoute, type TourStep } from "@/shared/ui/app/guided-tour";
import {
  OVERDUE_HOLDOUT_SPEAKER_KEY,
  RESOURCE_PAGES,
  ROOMS,
  SESSIONS,
  SET_PIECE_TARGET_SLOT,
  SET_PIECE_TRAY_SESSION_KEY,
  SPEAKERS,
  SUBMISSIONS,
} from "../server/demo/dataset";
import { DEMO_PROVISION_PHASES, type DemoProvisionPhase } from "../tour-schemas";
import { anchorIsDialogBound } from "./anchors";
import {
  supportedTourSteps,
  TOUR_CHAPTERS,
  TOUR_CONTEXT_KEYS,
  TOUR_FIRST_CHAPTER_ID,
  TOUR_FIRST_STEP_ID,
  TOUR_STEPS,
  tourStepById,
  unavailableTourChapters,
} from "./script";

/**
 * The script's shape, enforced.
 *
 * These are not pedantic assertions about data: each one pins a decision that
 * is expensive to relearn. The act ratio is what separates a tutorial from a
 * slideshow. The copy limits are what keep a card readable at the size the
 * spotlight leaves it. And "no objective equals its own route" is the rule
 * that stops a step satisfying itself on arrival and flashing past unread —
 * the single easiest way to ship a tour that looks broken.
 */

const CHAPTER_IDS = new Set(TOUR_CHAPTERS.map((chapter) => chapter.id));
const ARC = arcSteps(TOUR_STEPS);
const QUESTS = TOUR_STEPS.filter((step) => step.optional === true);

function routeKey(route: TourRoute): string {
  const query = Object.entries(route.query ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return `${route.path}?${query.map(([key, value]) => `${key}=${value}`).join("&")}`;
}

function tokensIn(route: TourRoute): string[] {
  const source = [route.path, ...Object.values(route.query ?? {})].join(" ");
  return [...source.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/gu)].map((match) => match[1] ?? "");
}

function copyOf(step: TourStep): string[] {
  return [step.title, step.body, step.hint ?? "", step.reward?.line ?? "", step.continueLabel ?? "", step.declineLabel ?? ""];
}

describe("guided tour script", () => {
  it("pins ten numbered chapters plus a curtain call", () => {
    // Changing this is allowed; changing it by accident is not. Ten is a
    // legible number for a progress line and the cut list (Judgement, the
    // field trip, mission control) is already written against it.
    expect(TOUR_CHAPTERS).toHaveLength(11);
    expect(TOUR_CHAPTERS.at(-1)?.id).toBe("curtain-call");
    expect(TOUR_CHAPTERS.filter((chapter) => chapter.optional === true).map((chapter) => chapter.id))
      .toEqual(["judgement", "field-trip", "mission-control"]);
  });

  it("starts on the cursor the migration defaults to", () => {
    // `drizzle/0044` writes these two literals as column defaults, so a freshly
    // provisioned demo lands on a step that must exist.
    expect(TOUR_FIRST_STEP_ID).toBe("coldopen.hello");
    expect(TOUR_FIRST_CHAPTER_ID).toBe("cold-open");
    expect(ARC[0]?.id).toBe(TOUR_FIRST_STEP_ID);
    expect(tourStepById(TOUR_FIRST_STEP_ID)?.chapter).toBe(TOUR_FIRST_CHAPTER_ID);
  });

  it("gives every step a unique id in a chapter that exists", () => {
    const ids = TOUR_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const step of TOUR_STEPS) expect(CHAPTER_IDS.has(step.chapter), step.id).toBe(true);
  });

  it("runs the golden path in chapter order, one contiguous run each", () => {
    // The engine walks the arc in array order, so a chapter split across two
    // runs would send the player back to a chapter they finished.
    const order = ARC.map((step) => step.chapter);
    const runs = order.filter((chapter, index) => chapter !== order[index - 1]);
    expect(new Set(runs).size).toBe(runs.length);
    const declared = TOUR_CHAPTERS.map((chapter) => chapter.id).filter((id) => runs.includes(id));
    expect(runs).toEqual(declared);
  });

  it("is at least 60 per cent act across the golden path", () => {
    // A step that could have asked the organizer to do something and instead
    // narrated at them is a design bug, not a style preference.
    const acts = ARC.filter((step) => step.kind === "act");
    expect(acts.length / ARC.length).toBeGreaterThanOrEqual(0.6);
  });

  it("spends no more than six beats on the whole tour", () => {
    const beats = TOUR_STEPS.filter((step) => step.kind === "beat");
    expect(beats.length).toBeLessThanOrEqual(6);
    // The two beats that own the screen are the only two that earn a modal.
    const modal = TOUR_STEPS.filter((step) => step.presentation === "modal" || step.presentation === "modal-wide");
    expect(modal.map((step) => step.id)).toEqual(["coldopen.hello", "curtain.done"]);
    for (const step of modal) expect(step.kind, step.id).toBe("beat");
  });

  it("gives every act an objective, and nothing else one", () => {
    for (const step of TOUR_STEPS) {
      if (step.kind === "act") expect(step.objective, step.id).toBeDefined();
      else expect(step.objective, step.id).toBeUndefined();
    }
  });

  it("never lets a step satisfy its own arming route", () => {
    // Routing the player to `?view=decided` and then verifying `?view=decided`
    // completes the instant the card appears. The organizer sees a flash.
    for (const step of TOUR_STEPS) {
      if (!step.route || step.objective?.via !== "route") continue;
      expect(routeKey(step.objective), step.id).not.toBe(routeKey(step.route));
    }
  });

  it("only interpolates context the route module supplies", () => {
    for (const step of TOUR_STEPS) {
      if (!step.route) continue;
      for (const token of tokensIn(step.route)) {
        expect(TOUR_CONTEXT_KEYS as readonly string[], `${step.id} -> :${token}`).toContain(token);
      }
      if (step.objective?.via === "route") {
        for (const token of tokensIn(step.objective)) {
          expect(TOUR_CONTEXT_KEYS as readonly string[], `${step.id} objective -> :${token}`).toContain(token);
        }
      }
    }
  });

  it("keeps every card inside the copy budget", () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length, `${step.id} title: ${step.title}`).toBeLessThanOrEqual(48);
      expect(step.title.trim().length, step.id).toBeGreaterThan(0);
      expect(step.body.length, `${step.id} body`).toBeLessThanOrEqual(220);
      expect(step.body.trim().length, step.id).toBeGreaterThan(0);
    }
  });

  it("keeps the voice dry", () => {
    // No exclamation marks. Openboard's copy is specific and slightly wry, and
    // enthusiasm punctuation reads as a product that is trying too hard.
    for (const step of TOUR_STEPS) {
      for (const line of copyOf(step)) expect(line, step.id).not.toContain("!");
    }
  });

  it("celebrates once per chapter and no more", () => {
    // Four big moments, rationed. Everything else is one small emoji at the
    // end of a chapter; two in a chapter devalues both.
    const perChapter = new Map<string, number>();
    for (const step of ARC) {
      if (!step.reward) continue;
      perChapter.set(step.chapter, (perChapter.get(step.chapter) ?? 0) + 1);
    }
    for (const [chapter, count] of perChapter) expect(count, chapter).toBe(1);
    const biggest = ARC.filter((step) => (step.reward?.drops ?? 0) >= 18).map((step) => step.id);
    expect(biggest).toEqual(["grid.resolve", "curtain.done"]);
  });

  it("names its side quests so the server can count them separately", () => {
    // `TOUR_QUEST_STEP_PREFIX` is how the finale says "17 of 19 objectives ·
    // 2 side quests" without a second column that could disagree.
    for (const step of TOUR_STEPS) {
      expect(step.id.startsWith("quest."), step.id).toBe(step.optional === true);
    }
    expect(QUESTS.length).toBeGreaterThanOrEqual(6);
  });

  it("suppresses the scrim for anything anchored inside a dialog", () => {
    // A native `<dialog>` paints in the top layer, above every z-index there
    // is. A scrim over one dims the page and leaves the dialog undimmed.
    for (const step of TOUR_STEPS) {
      if (!anchorIsDialogBound(step.anchor)) continue;
      expect(step.spotlight, step.id).toBe(false);
    }
  });

  it("owes the player a sentence for every chapter mobile drops", () => {
    const dropped = new Set(TOUR_STEPS.filter((step) => step.desktopOnly === true).map((step) => step.chapter));
    for (const chapter of dropped) {
      const note = TOUR_CHAPTERS.find((candidate) => candidate.id === chapter)?.mobileNote;
      expect(note, chapter).toBeTruthy();
    }
  });

  it("names the speaker who actually holds the overdue task", () => {
    // Chapter 6 tells the organizer to impersonate a named speaker and finish
    // one of their tasks. Name the wrong one and the objective can never fire:
    // only the dataset's overdue holdout is an accepted speaker with an open
    // assignment, and the copy has no other way to stay honest about it.
    const holdout = SPEAKERS.find((speaker) => speaker.key === OVERDUE_HOLDOUT_SPEAKER_KEY);
    expect(holdout, OVERDUE_HOLDOUT_SPEAKER_KEY).toBeDefined();
    const fieldTrip = TOUR_STEPS.filter((step) => step.chapter === "field-trip" && step.optional !== true);
    const copy = fieldTrip.flatMap(copyOf).join(" ");
    expect(copy).toContain(`${holdout?.firstName} ${holdout?.lastName}`);
    for (const other of SPEAKERS) {
      if (other.key === OVERDUE_HOLDOUT_SPEAKER_KEY) continue;
      expect(copy, other.key).not.toContain(`${other.firstName} ${other.lastName}`);
    }
  });

  it("counts the pile and the queue the way the provisioned world does", () => {
    // The cold open is the tutorial's first verifiable claim and the dashboard
    // is directly behind it, so a wrong number there spends the whole argument
    // in one screen. It shipped saying "24 proposals waiting on a decision"
    // against a world built with four pending — a figure the attention row,
    // the Pending tile and the Submissions badge all print the moment the
    // modal closes. Triage repeated the mistake from the other side, calling a
    // four-row needs-decision view "two dozen proposals".
    // Both cards spell the queue out in words, so the count is pinned here
    // rather than interpolated: a dataset that stops building four pending
    // proposals fails on this line, next to the two strings to change.
    const pending = SUBMISSIONS.filter((submission) => submission.status === "pending").length;
    expect(pending, "the cold open and triage both say 'four'").toBe(4);

    const coldOpen = copyOf(tourStepById("coldopen.hello") as TourStep).join(" ");
    expect(coldOpen).toContain(`${SUBMISSIONS.length} proposals`);
    expect(coldOpen).toContain("four of them still waiting on you");
    expect(coldOpen).toContain(`${SPEAKERS.length} speakers`);

    const triage = copyOf(tourStepById("triage.rows") as TourStep).join(" ");
    expect(triage).toContain("Four proposals still waiting on you");
    expect(triage).toContain("Twenty-four arrived");
    expect(triage).not.toContain("Two dozen");
  });

  it("names the resource page the world actually leaves in draft", () => {
    // The quest asks for a publish, so it has to name a page that is not
    // published. It shipped naming the speaker handbook, which provisioning
    // publishes — the row it pointed at wore a Published badge, and the hint
    // underneath it described a different row.
    const drafts = RESOURCE_PAGES.filter((page) => !page.published);
    expect(drafts, "the quest names one page, so the dataset must leave exactly one").toHaveLength(1);
    const quest = tourStepById("quest.speaker-resources") as TourStep;
    expect(quest.title.toLowerCase()).toContain(drafts[0]?.title.toLowerCase());
    for (const published of RESOURCE_PAGES.filter((page) => page.published)) {
      expect(quest.title.toLowerCase(), published.key).not.toContain(published.title.toLowerCase());
    }
  });

  it("counts the templates an event actually owns", () => {
    // `TEMPLATE_KEYS` has fourteen entries and the Templates tab renders
    // eleven: password reset, address verification and the organization
    // invitation are account mail, sent by no event and editable on no event's
    // tab. The card said fourteen and the player could count.
    const eventTemplates = TEMPLATE_KEYS.filter((key) => !key.startsWith("admin_") && key !== "organization_invited");
    const copy = copyOf(tourStepById("mission.templates") as TourStep).join(" ");
    expect(eventTemplates).toHaveLength(11);
    expect(copy).toContain("Eleven templates");
    expect(copy).not.toContain("Fourteen");
  });

  it("names a talk the tray is actually holding, and a slot that is actually taken", () => {
    // Chapter 7 is the one chapter that names a specific row of provisioned
    // content and a specific minute of the grid. Both halves have to be true
    // of the dataset or the set-piece stalls: name a talk the provisioner
    // already scheduled and there is nothing in the tray to open — which is
    // exactly how this shipped once, with `sessionsScheduled` armed on a
    // session that was on the grid before the organizer arrived.
    const place = tourStepById("grid.place");
    expect(place?.objective).toEqual({ via: "world", fact: "sessionsScheduled", delta: "increased" });
    const copy = copyOf(place as TourStep).join(" ");

    // The talk is named by the part of its title that reads as a name, which
    // is what the card has room for and what the tray shows first.
    const shortTitle = (title: string) => (title.split(":")[0] ?? title).trim();
    const named = SESSIONS.filter((session) => copy.includes(shortTitle(session.title)));
    expect(named.map((session) => session.key)).toEqual([SET_PIECE_TRAY_SESSION_KEY]);
    expect(named[0]?.placement, "the talk Chapter 7 names must start unscheduled").toBeNull();

    // And the slot it sends that talk to, so the trap the next two steps
    // narrate is the trap the copy set up.
    const room = ROOMS.find((candidate) => candidate.key === SET_PIECE_TARGET_SLOT.roomKey);
    expect(copy).toContain(room?.name);
    expect(copy).toContain(SET_PIECE_TARGET_SLOT.start);
  });

  it("hands the finished player a route to a real event", () => {
    // Design §5.4's first hand-off nudge. The curtain call is the moment of
    // maximum intent, and a modal whose only button is "Keep playing" spends
    // it. The other two nudges (the ribbon, the organization home) are behind
    // this modal, so without this one they are the *only* invitation.
    const last = ARC.at(-1);
    expect(last?.chapter).toBe("curtain-call");
    expect(last?.action?.href).toContain("/organizations/");
    expect(last?.action?.href).toContain("mode=create");
    expect(last?.action?.label).toBeTruthy();
  });

  it("interpolates action hrefs from the same context the routes use", () => {
    // An action href is navigated through `resolveTourPath` like every route.
    // A token the route module does not supply navigates the organizer to a
    // literal colon, which looks exactly like a broken product.
    for (const step of TOUR_STEPS) {
      const href = step.action?.href;
      if (!href) continue;
      for (const match of href.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/gu)) {
        expect(TOUR_CONTEXT_KEYS as readonly string[], `${step.id} action -> :${match[1]}`).toContain(match[1]);
      }
    }
  });

  it("gives every self-verified act a control of its own to press", () => {
    // `via: "self"` means nothing outside the card can observe the objective —
    // the trip is to another document. The card's own button is the only
    // possible evidence, so a step declaring one without the other is a step
    // that can never complete.
    for (const step of TOUR_STEPS) {
      if (step.objective?.via === "self") expect(step.action, step.id).toBeDefined();
      if (step.action && step.kind === "act") expect(step.objective?.via, step.id).toBe("self");
    }
  });

  it("offers a way out of every act that could stick", () => {
    // A world objective can only be reached by doing the thing. Each one owes
    // the player either a hint or an anchor they can actually see.
    for (const step of TOUR_STEPS) {
      if (step.objective?.via !== "world") continue;
      expect(Boolean(step.hint) || Boolean(step.anchor), step.id).toBe(true);
    }
  });
});

describe("supportedTourSteps", () => {
  const FULL = { cfpFormId: "f1", editableFormId: "f2", eventSlug: "s", organizationId: "o", eventId: "e" };
  const idsFor = (skipped: DemoProvisionPhase | null, context = FULL) =>
    new Set(supportedTourSteps(skipped, context).map((step) => step.id));

  it("keeps the whole script for a world that built in full", () => {
    expect(supportedTourSteps(null, FULL)).toHaveLength(TOUR_STEPS.length);
  });

  it("drops a side quest whose payload comes from a later phase than its chapter's", () => {
    // The reason this needs a per-step rule at all: both quests sit in a
    // chapter that `unavailableTourChapters` keeps, so the chapter rule alone
    // leaves the tray offering a detour into a page nothing ever wrote.
    const atResources = idsFor("resources");
    expect(atResources.has("quest.speaker-resources")).toBe(false);
    expect(unavailableTourChapters("resources")).not.toContain("field-trip");
    // Its chapter-mate is written by `portal`, which did run.
    expect(atResources.has("quest.chase-a-speaker")).toBe(true);

    const atComms = idsFor("comms");
    expect(atComms.has("quest.outbox")).toBe(false);
    expect(unavailableTourChapters("comms")).not.toContain("the-decision");
  });

  it("keeps those quests when their own phase did run", () => {
    // Skipping at `ready` skips nothing: every phase before it completed.
    expect(idsFor("ready").has("quest.speaker-resources")).toBe(true);
    expect(idsFor("ready").has("quest.outbox")).toBe(true);
  });

  it("drops a step whose route needs a context id this world does not have", () => {
    // `editableFormId` goes null in ordinary free play, with no phase skipped
    // at all, as soon as every form on the event carries an answer.
    const withoutEditable = idsFor(null, { ...FULL, editableFormId: "" });
    expect(withoutEditable.has("call.add-question")).toBe(false);
    // Its chapter survives — the forms phase ran — so nothing else in `the-call` goes.
    expect(withoutEditable.has("call.visibility")).toBe(true);
  });

  it("derives the requirement from the route template rather than a hand-kept list", () => {
    // The guarantee that matters: any step interpolating a context id is
    // dropped when that id is empty, including ones added after this test.
    for (const key of ["cfpFormId", "editableFormId"] as const) {
      const kept = supportedTourSteps(null, { ...FULL, [key]: "" });
      for (const step of kept) {
        const templates = [step.route?.path, step.objective?.via === "route" ? step.objective.path : undefined];
        for (const template of templates) expect(template ?? "", `${step.id} kept without ${key}`).not.toContain(`:${key}`);
      }
    }
  });

  it("hands back no tour at all rather than a mutilated one when the event id is missing", () => {
    // Every route in the script is anchored on `/events/:eventId`. Dropped one
    // step at a time, an empty id left seven orphans across five chapters and
    // no curtain call — a five-chapter "tour" whose last step is a subject
    // line in Mission Control. That is not a smaller tutorial, it is wreckage,
    // and the engine reads a step with no successor as the player having
    // finished, so it retires itself there permanently.
    expect(supportedTourSteps(null, { ...FULL, eventId: "" })).toEqual([]);
    expect(supportedTourSteps(null, { ...FULL, eventId: null })).toEqual([]);
  });

  it("always leaves the player a curtain call to reach, whatever this world is missing", () => {
    // The property the failure above violated, checked across every shape a
    // host can hand this: the golden path either does not exist or ends where
    // the script ends. A configuration that stops the arc anywhere else ends
    // the tour in silence, mid-chapter, with no way back in.
    const contextKeys = TOUR_CONTEXT_KEYS;
    const phases: Array<DemoProvisionPhase | null> = [null, ...DEMO_PROVISION_PHASES];
    for (const phase of phases) {
      // Every subset of the ids a real world can be missing, as a bitmask.
      for (let mask = 0; mask < 2 ** contextKeys.length; mask += 1) {
        const context = { ...FULL };
        const missing: string[] = [];
        contextKeys.forEach((key, index) => {
          if ((mask & (1 << index)) === 0) return;
          context[key] = "";
          missing.push(key);
        });
        const unavailable = new Set(unavailableTourChapters(phase));
        for (const mobile of [false, true]) {
          const runnable = supportedTourSteps(phase, context)
            .filter((step) => !unavailable.has(step.chapter))
            .filter((step) => !(mobile && step.desktopOnly === true));
          const last = arcSteps(runnable).at(-1);
          const where = `phase=${phase ?? "none"} missing=[${missing.join(",")}] mobile=${mobile}`;
          if (!last) continue;
          expect(last.chapter, where).toBe("curtain-call");
        }
      }
    }
  });
});
