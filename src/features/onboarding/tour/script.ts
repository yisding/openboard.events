import type {
  TourAnchorSpec,
  TourChapter,
  TourObjective,
  TourRoute,
  TourStep,
  TourWorldDelta,
} from "@/shared/ui/app/guided-tour";
import { DEMO_PROVISION_PHASES, type DemoProvisionPhase, type WorldFactKey } from "../tour-schemas";
import { tourIdAnchor } from "./anchors";

/**
 * First Fair — the script.
 *
 * Pure data. No server imports, no React, no `"use client"`: a route module
 * reads it on the server and hands it to the shell as a prop, which is what
 * keeps `architecture:check`'s `shell -> shared` edge intact and keeps every
 * byte of this file out of a real-event organizer's bundle.
 *
 * Three rules shape every entry, and `script.test.ts` enforces all three:
 *
 *   1. **`act` is the default.** A step that could ask the organizer to do
 *      something and instead narrates at them is a design bug. The golden path
 *      is at least 60 % `act`, and a `beat` costs one of six for the whole
 *      tour.
 *   2. **Objectives are world state, never clicks.** `via: "world"` asks the
 *      server whether reality moved, so finishing a step in a second tab, on a
 *      phone, after a refresh, or by a route nobody scripted all count. An
 *      objective may never be the step's own route, or it satisfies on arrival
 *      and the card flashes past unread.
 *   3. **Never explain a noun; state a stake.** Not "the Conflicts tab shows
 *      conflicts" — "Main Stage was already busy. Openboard noticed before
 *      your speakers did." Titles are imperative and ≤ 48 characters; bodies
 *      are one idea and ≤ 220.
 */

/* --- interpolation ------------------------------------------------------ */

/**
 * The `:token` names every route in this file may use. The route module owns
 * the values; `script.test.ts` asserts nothing here reaches for a token the
 * host does not supply, because an unresolved token navigates the organizer to
 * a literal `/events/:eventId/agenda` and looks exactly like a broken product.
 */
export const TOUR_CONTEXT_KEYS = ["eventId", "eventSlug", "cfpFormId", "editableFormId", "organizationId"] as const;
export type TourContextKey = (typeof TOUR_CONTEXT_KEYS)[number];

const EVENT = "/events/:eventId";

function at(path: string, query?: Readonly<Record<string, string>>): TourRoute {
  return query ? { path: `${EVENT}${path}`, query } : { path: `${EVENT}${path}` };
}

function goneTo(path: string, query?: Readonly<Record<string, string>>): TourObjective {
  return { via: "route", ...at(path, query) };
}

/** A world objective, with the fact name checked against the server's snapshot. */
function world(fact: WorldFactKey, delta: TourWorldDelta): TourObjective {
  return { via: "world", fact, delta };
}

function css(selector: string): TourAnchorSpec {
  return { kind: "selector", css: selector };
}

function named(role: string, name: string): TourAnchorSpec {
  return { kind: "role", role, name };
}

/* --- chapters ----------------------------------------------------------- */

/**
 * Ten numbered chapters and a curtain call. Chapters have names because the
 * resume pill and the progress line use them, and "Chapter 6 of 11 — The grid"
 * is a place; "step 19 of 33" is a progress bar with delusions.
 *
 * Judgement, the field trip and mission control are `optional`: offered in
 * sequence with a one-click skip, never hidden behind a disclosure. The
 * required arc is roughly eight minutes; all of it is about thirteen.
 */
export const TOUR_CHAPTERS: readonly TourChapter[] = [
  { id: "cold-open", name: "Cold open" },
  {
    id: "command-deck",
    name: "Command deck",
    unavailableNote: "Your speaker roster never finished building, so we skipped the tour of it. Reset the demo from the ribbon and it will be there.",
  },
  {
    id: "the-call",
    name: "The call",
    unavailableNote: "The call for speakers never finished building, so there is no form to open. Reset the demo from the ribbon to get it back.",
  },
  {
    id: "triage",
    name: "Triage",
    unavailableNote: "The two dozen proposals never landed, so the review queue is empty. Reset the demo from the ribbon to fill it.",
  },
  {
    id: "judgement",
    name: "Judgement",
    optional: true,
    unavailableNote: "The scoring rounds never finished building, so there is nothing assigned to you yet.",
  },
  {
    id: "the-decision",
    name: "The decision",
    unavailableNote: "There are no proposals to decide on — that part of the build did not finish.",
  },
  {
    id: "field-trip",
    name: "Field trip",
    optional: true,
    unavailableNote: "The speaker portal's tasks never finished building, so there is nothing waiting over there.",
  },
  {
    id: "the-grid",
    name: "The grid",
    mobileNote: "Scheduling wants a bigger screen, so we skipped ahead. Come back on a laptop for that one — it is the best chapter.",
    unavailableNote: "The schedule never finished building, so there is no grid to fix. Reset the demo from the ribbon and this chapter comes back.",
  },
  {
    id: "go-live",
    name: "Go live",
    unavailableNote: "There is no agenda to publish — the schedule never finished building.",
  },
  {
    id: "mission-control",
    name: "Mission control",
    optional: true,
    unavailableNote: "The delivery log never finished building, so there is nothing in it to read.",
  },
  { id: "curtain-call", name: "Curtain call" },
];

/**
 * Which provisioning phase each chapter's world comes out of.
 *
 * "Continue without it" (design §2.8) lets an organizer past a phase that
 * would not take, at the cost of everything that phase and the phases after it
 * would have written. A chapter listed here is dropped — with its
 * `unavailableNote` — when its phase never ran, rather than routing the player
 * to a page with nothing on it and arming an objective the world can never
 * satisfy. Chapters absent from this map need no payload: the cold open and
 * the curtain call are both beats on the dashboard.
 */
const CHAPTER_PHASE: Readonly<Record<string, DemoProvisionPhase>> = {
  "command-deck": "people",
  "the-call": "forms",
  triage: "submissions_a",
  judgement: "evaluation",
  "the-decision": "submissions_a",
  "field-trip": "portal",
  "the-grid": "agenda",
  "go-live": "agenda",
  "mission-control": "comms",
};

/**
 * The chapters a world built only up to `skippedAtPhase` cannot run.
 *
 * The skip jumps the cursor straight to `ready`, so the phase recorded is the
 * first one that never ran and every phase after it never ran either — which
 * is why this compares positions in `DEMO_PROVISION_PHASES` rather than
 * looking for an exact match. `null` (the overwhelmingly common case: a world
 * that built in full) drops nothing.
 */
export function unavailableTourChapters(skippedAtPhase: DemoProvisionPhase | null): readonly string[] {
  if (skippedAtPhase === null) return [];
  const stoppedAt = DEMO_PROVISION_PHASES.indexOf(skippedAtPhase);
  if (stoppedAt < 0) return [];
  return Object.entries(CHAPTER_PHASE)
    .filter(([, phase]) => DEMO_PROVISION_PHASES.indexOf(phase) >= stoppedAt)
    .map(([chapter]) => chapter);
}

/* --- the golden path ---------------------------------------------------- */

/**
 * Chapter 0 — Cold open.
 *
 * Every number in here is a number the product renders within ninety seconds,
 * and each one matches what provisioning actually wrote. A tutorial whose
 * first verifiable claim is false has spent its whole argument in one screen.
 *
 * "I'll poke around myself" pauses at step one and leaves the organizer in a
 * fully populated dashboard with the resume pill showing. Declining the
 * tutorial must never cost them the world.
 */
const COLD_OPEN: readonly TourStep[] = [
  {
    id: "coldopen.hello",
    chapter: "cold-open",
    kind: "beat",
    presentation: "modal",
    title: "AI Engineer World's Fair is 65 days out.",
    // "24 proposals waiting on a decision" was false on the screen behind this
    // very modal: the demo is built with four pending, and the dashboard's own
    // attention row — visible the moment this card is dismissed — says so.
    // Twenty-four is the size of the pile that arrived, not the size of the
    // queue, and `script.test.ts` now holds both numbers against the dataset.
    body: "18 speakers. 24 proposals, four of them still waiting on you. Two scheduling conflicts nobody has noticed yet. None of it is real, all of it works, and nothing in here can email a living person.",
    route: at("/dashboard"),
    continueLabel: "Let's go",
    declineLabel: "I'll poke around myself",
  },
];

const COMMAND_DECK: readonly TourStep[] = [
  {
    id: "deck.attention",
    chapter: "command-deck",
    kind: "observe",
    title: "Everything that needs you, ranked.",
    body: "Ordered by how much is waiting, and the row itself is the link. No separate view button, no cap-and-count-the-rest.",
    route: at("/dashboard", { tab: "today" }),
    anchor: tourIdAnchor("dashboard.attention-row"),
    placement: "bottom",
  },
  {
    id: "deck.palette",
    chapter: "command-deck",
    kind: "observe",
    title: "Press ⌘K (Ctrl+K on Windows/Linux).",
    body: "Speakers, submissions, sessions and quick actions, from any screen in any event. It is how the fast organizers work.",
    anchor: named("button", "Search anything"),
    placement: "bottom-end",
  },
  {
    id: "deck.speakers-tab",
    chapter: "command-deck",
    kind: "act",
    title: "Open Speaker Tracking.",
    body: "Some of your speakers still owe you a bio, and this tab already knows which ones. You do not.",
    anchor: css(".dashboard-tabs"),
    placement: "bottom",
    objective: goneTo("/dashboard", { tab: "speakers" }),
    hint: "The two dashboard links sit just under the page title.",
    reward: { emoji: "⌘", line: "You can drive." },
  },
];

/**
 * Chapter 2 — The call.
 *
 * Both objectives here are server-observable because builder edits are real
 * rows: `createFieldIn` writes `form_fields`, `compileAndPublishIn` writes
 * `form_versions`. Nothing is inferred from a client success handler.
 */
const THE_CALL: readonly TourStep[] = [
  {
    id: "call.open-form",
    chapter: "the-call",
    kind: "act",
    title: "Open Speak at AI Engineer World's Fair.",
    body: "Your call for speakers has been open for twenty days and has already collected two dozen proposals. Go and see how it is put together.",
    route: at("/forms"),
    anchor: css(".form-list-card"),
    objective: goneTo("/forms/:cfpFormId"),
  },
  {
    id: "call.add-question",
    chapter: "the-call",
    kind: "act",
    title: "Add a question to the lightning form.",
    body: "Your main call is locked: two dozen people have answered it, and their answers are pinned to the version they read. The Expo Stage form has no answers yet, so it is still yours to change.",
    route: at("/forms/:editableFormId"),
    anchor: css(".add-question"),
    placement: "top",
    objective: world("formFields", "increased"),
    hint: "Try “Have you given this talk before?” — Add question sits under the list. Name it, pick a response type, save.",
  },
  {
    id: "call.visibility",
    chapter: "the-call",
    kind: "observe",
    title: "Conditional questions, already wired.",
    body: "Back on the main call: select Workshop duration in the list. Its rule is in the inspector — ask this one only when the format is Workshop.",
    route: at("/forms/:cfpFormId"),
    anchor: css(".visibility-rule-editor"),
    placement: "left",
  },
  {
    id: "call.preview-workshop",
    chapter: "the-call",
    kind: "act",
    title: "In the preview, set Format to Workshop.",
    body: "A question you did not put on this page appears, because the form knows when to ask it. Nothing you type in here is saved.",
    route: at("/forms/:cfpFormId/preview"),
    anchor: tourIdAnchor("forms.workshop-duration"),
    objective: { via: "dom", present: "forms.workshop-duration" },
  },
  {
    id: "call.publish",
    chapter: "the-call",
    kind: "act",
    title: "Publish the version.",
    body: "Every publish is an immutable snapshot. Proposals already in flight keep answering the version their speaker actually read.",
    route: at("/forms/:cfpFormId"),
    anchor: named("button", "Publish version — publishes the current step as a new immutable form version"),
    objective: world("formVersions", "increased"),
    reward: { emoji: "📝", line: "A new version, and nobody's draft changed under them." },
  },
];

const TRIAGE: readonly TourStep[] = [
  {
    id: "triage.rows",
    chapter: "triage",
    kind: "observe",
    // Not "two dozen proposals, one queue": this step opens the
    // *needs-decision* view, and that view holds four rows. The tab strip the
    // next step is about prints both numbers side by side, so a card claiming
    // twenty-four here was contradicted by the control it was standing on.
    title: "Four proposals still waiting on you.",
    body: "Twenty-four arrived and the rest are settled. Open any row on the way past: the drawer pins every answer to the form version that speaker actually filled in, not to today's.",
    route: at("/abstracts", { view: "needs_decision" }),
    anchor: tourIdAnchor("abstracts.row"),
    placement: "bottom",
  },
  {
    id: "triage.decided",
    chapter: "triage",
    kind: "act",
    title: "Show me what is already decided.",
    body: "The count on each tab comes from the same query as the rows under it, so a tab can never disagree with its own table.",
    anchor: css(".abstract-status-tabs"),
    placement: "bottom",
    objective: goneTo("/abstracts", { view: "decided" }),
  },
  {
    id: "triage.back",
    chapter: "triage",
    kind: "act",
    title: "Now back to what needs you.",
    body: "Every filter lives in the URL. Send that link to a co-organizer and they open exactly the view you were looking at.",
    anchor: css(".abstract-status-tabs"),
    placement: "bottom",
    objective: goneTo("/abstracts", { view: "needs_decision" }),
    reward: { emoji: "🔍", line: "Filtered, counted and shareable." },
  },
];

/**
 * Chapter 4 — Judgement. Inline-optional.
 *
 * Round 1 is assigned to whoever is taking the tour, with zero reviews on the
 * board. No score is fabricated on their behalf: the aggregate goes from a
 * dash to a number they caused all of, which is a better beat than an inflated
 * fixture and does not put a lie in the audit trail of the one feature whose
 * entire value is that its record is trustworthy.
 */
const JUDGEMENT: readonly TourStep[] = [
  {
    id: "judge.rounds",
    chapter: "judgement",
    kind: "observe",
    title: "Two rounds, and the second one is blind.",
    body: "Round 1 is open and yours. Round 2 anonymises the proposal and the reviewer, so nobody scores a name they recognise.",
    route: at("/evaluation"),
    anchor: css(".plan-window"),
    // Left, not right (#716). `.plan-window` resolves to round 1's cell, and
    // a card dropped underneath it lands on round 2's row below — covering
    // the *Blind review* badge that is the entire evidence for the sentence
    // above. Right dodged that (both rows' Window column stays clear below
    // the card) but opened onto the Reviewers/Progress/Status columns beside
    // it instead. Left clears both: the coach card is wider than the Window
    // column, so opening left of it lands entirely on the Round/#/Scale/Scope
    // columns — the only ones neither round's badge nor the assignment
    // columns share a pixel with.
    placement: "left",
  },
  {
    id: "judge.score",
    chapter: "judgement",
    kind: "act",
    title: "Score one.",
    body: "Six proposals are assigned to you and none of them is scored. Weighted criteria, one to five, and your note is pinned to the version you read.",
    route: at("/review"),
    anchor: css(".score-panel"),
    placement: "left",
    objective: world("reviewsByMe", "increased"),
    hint: "Press 1 to 5 to score the open proposal, then save.",
    reward: { emoji: "⚖️", line: "The aggregate just appeared, and it is entirely yours." },
  },
];

/**
 * Chapter 5 — The decision, and the chapter that teaches the safety model.
 *
 * The confirm step is anchored inside a `ConfirmDialog`, so it carries
 * `spotlight: false`: the dialog is painted in the top layer and no scrim can
 * reach it. The chapter ends on the delivery log, where every row the
 * organizer just queued reads *skipped* with a reason. A tutorial that quietly
 * disabled email would be a lie; one that shows the suppression working is a
 * demonstration of the product's care.
 */
const THE_DECISION: readonly TourStep[] = [
  // Two instructions, two targets, two steps. It shipped as one card that said
  // "tick three rows, then Move to accept queue" and spotlit the first row's
  // *title* — the one part of the row that does nothing when you click it, and
  // nowhere near the button the second half of the sentence names. A step
  // points at one control; a step that has to name two controls is two steps.
  {
    id: "decide.select",
    chapter: "the-decision",
    kind: "act",
    // Not "Tick three proposals". The objective below is satisfied by the
    // action bar appearing, and the bar appears on the *first* tick — so a
    // card demanding three sat there contradicting itself the moment one was
    // ticked, saying "Tick three proposals" and "Done." in the same breath.
    // Nothing in the world counts a selection, so the copy is what gives: three
    // is the suggestion the demo is built around, not a requirement the step
    // then fails to hold anybody to.
    title: "Tick the proposals you would accept.",
    body: "The checkboxes are the first column, and three is a good number to take. An action bar appears along the bottom the moment one row is ticked.",
    route: at("/abstracts", { view: "needs_decision" }),
    // The first body row's checkbox cell. `.select-cell` is the shared table's
    // own class for that column, so this is the cheap rung of the ladder
    // rather than another pinned attribute.
    anchor: css(".select-cell"),
    // Above, not beside. The instruction is "tick three", so the two rows
    // under this one have to stay clickable — and a 320px card opening to the
    // right of a 44px cell lands squarely on the titles the organizer is
    // reading to choose between them.
    placement: "top",
    // The bar the next step lives in exists only while something is selected,
    // which makes its arrival the honest evidence that a row was ticked.
    objective: { via: "dom", present: "abstracts.move-accept" },
  },
  {
    id: "decide.queue",
    chapter: "the-decision",
    kind: "act",
    title: "Move them to the accept queue.",
    body: "Nothing is sent by that. A queue is a promise you can still take back, and the emails do not exist until you say so on the next screen.",
    anchor: tourIdAnchor("abstracts.move-accept"),
    placement: "top",
    objective: world("pendingCount", "decreased"),
    hint: "The action bar sits along the bottom of the table while rows are selected.",
  },
  {
    id: "decide.preflight",
    chapter: "the-decision",
    kind: "observe",
    title: "Send the decision emails.",
    body: "Openboard shows you every recipient and the exact message before a single row moves. Press send and read what it offers you.",
    anchor: tourIdAnchor("abstracts.decision-notify"),
    placement: "top",
  },
  {
    id: "decide.confirm",
    chapter: "the-decision",
    kind: "act",
    title: "Confirm the queue.",
    body: "Counts, a sample of each message, and any speaker with no address. Queue decision emails once it reads the way you expect.",
    anchor: css(".decision-email-preflight"),
    // Right, not the default bottom (#716). The card portals into the open
    // dialog (`portalTargetFor` in anchor.tsx) and is clamped to its box, and
    // `.decision-email-preflight` is the whole scrollable body — taller than
    // the dialog itself, so its bottom edge sits far below the viewport and
    // the default placement fell back to the viewport's bottom edge, right on
    // top of the decline sample's message the copy invites reading. The wide
    // dialog leaves clear space beside it; right opens there instead of over
    // either sample.
    placement: "right",
    spotlight: false,
    objective: world("decisionEmailsQueued", "increased"),
  },
  {
    id: "decide.outbox",
    chapter: "the-decision",
    kind: "observe",
    title: "Real outbox, real dispatcher, zero mail.",
    // The sweeping claim, restored. It was hedged down to "the rows you just
    // queued" because phase 10 backdated six `sent` rows and one `failed` one,
    // which made the sweeping version falsifiable on the very screen this card
    // points at. Phase 10 now seeds all nine as `skipped`, so the column the
    // card names says what the card says, all the way down.
    //
    // No claim to a render, though (#679): the dispatcher skips a demo send
    // *before* it renders, which is why a live row carries the skip reason
    // where its subject would be. Only the backdated rows have subjects —
    // history the demo was built with, not something the dispatcher produced.
    //
    // The backdated rows number nine at the dataset level (`COMM_LOG_ROWS` in
    // demo/dataset.ts), but the log this card points at also holds the live
    // reminder sweeper's output — `task_assigned`/`task_reminder` rows for
    // every seeded assignment, ~50 more of them (#709). A player who counts
    // the rows on screen gets a number the copy no longer states, so the copy
    // stopped counting instead of trying to keep a second number in sync.
    body: "Every row reads skipped, reason: demo event — mail is never delivered. The oldest rows carry subjects the demo was built with; anything queued live stops before it renders, so the reason takes the subject's place.",
    route: at("/communications", { tab: "log" }),
    anchor: css("#communications-tab-log"),
    placement: "bottom",
    reward: { emoji: "📮", line: "Queued, logged and going absolutely nowhere." },
  },
];

/**
 * Chapter 6 — Field trip. Inline-optional, and it leaves the admin shell.
 *
 * The portal has no `AdminShell` and therefore no tour layer, which is fine:
 * the objective is `via: "world"`, so the moment the organizer finishes a task
 * in the other tab the card celebrates — before they even switch back. When
 * they do, `visibilitychange` fires an immediate refetch and they land on a
 * completed objective. That is a better moment than an in-page overlay.
 */
const FIELD_TRIP: readonly TourStep[] = [
  {
    id: "trip.find-gap",
    chapter: "field-trip",
    kind: "act",
    // Count-free on purpose: `accepted_speakers_v` only has as many rows as
    // submissions marked `accepted` by the time the player reaches here, and
    // Chapter 5's "queue three acceptances" step lets them pick *which*
    // three — so the roster size at this point is not a fixed number.
    // Zero headshots is true of every one of the eighteen seeded speaker
    // records regardless of which subset is accepted, so it stays literal.
    title: "Find the speakers with profile gaps.",
    body: "Every one of them is missing a headshot, and several have no bio. Filter the roster down to Any profile gap.",
    route: at("/speakers"),
    anchor: css(".speaker-filter-chips"),
    placement: "bottom",
    objective: goneTo("/speakers", { missing: "either" }),
  },
  {
    id: "trip.portal",
    chapter: "field-trip",
    kind: "act",
    // Victor Achebe, not Dana Whitfield. Dana's only submission is a draft, so
    // she is not an accepted speaker, holds no `task_assignments_v` row, and
    // has an empty portal — following this instruction with her name on it
    // dead-ends the chapter. Phase 8's `OVERDUE_HOLDOUT_KEY` names the same
    // person this copy does, and `script.test.ts` holds the two together.
    // Titled for the *objective*, not for the doorway.
    //
    // "Open the speaker portal as Victor" named the button the card
    // spotlights, so pressing it read as finishing the step — and then the
    // card went on pulsing "Waiting for you…" at a control the organizer had
    // just used, with nothing to say about why. The objective is a task
    // completed in the other tab; the button is how you get there.
    title: "Finish one of Victor's portal tasks.",
    body: "Real impersonation in a new tab, not a fixture switch. Opening the portal is only the door — this step finishes when a task of his does, and we will see it from here.",
    anchor: tourIdAnchor("speakers.impersonate"),
    placement: "bottom",
    objective: world("portalTaskCompletions", "increased"),
    // Three presses, named in order. The roster row opens a drawer, and the
    // drawer has no impersonation control on it: that lives on the full
    // profile behind it, which is where this anchor mounts. A hint that
    // skipped the middle step sent the organizer looking for a button that
    // was one page further on.
    hint: "Open Victor Achebe from the roster, press Open full profile, then Open portal as Victor — and complete one of his tasks in the new tab.",
  },
  {
    id: "trip.return",
    chapter: "field-trip",
    kind: "beat",
    // Past tense, deliberately: the objective only requires finishing *a*
    // task of Victor's (`portalTaskCompletions increased`), not specifically
    // the overdue one, so this has to read true either way — including when
    // the task the player just closed was the overdue one itself.
    title: "One of his tasks sat overdue for thirty days.",
    body: "Long enough for the reminder ladder to run its full course. Mission control shows exactly what it wrote to him, and exactly where all of it stopped.",
    reward: { emoji: "🎤", line: "You have now seen both sides of your own event." },
  },
];

/**
 * Chapter 7 — The grid. The set-piece.
 *
 * Engineered so the organizer *causes* a conflict and then fixes it, with the
 * product visibly agreeing at each step. The placement step is anchored to the
 * session dialog rather than the grid because drag simulation is banned by the
 * quality strategy — and because the dialog is also the accessible path.
 */
const THE_GRID: readonly TourStep[] = [
  {
    id: "grid.tray",
    chapter: "the-grid",
    kind: "observe",
    desktopOnly: true,
    title: "Three accepted talks with nowhere to be.",
    body: "Accepted is not scheduled. The tray holds everything the programme has said yes to and the grid has not found a room for yet.",
    route: at("/agenda", { view: "day" }),
    // Not `.unscheduled-tray`. That class belongs to the *workspace* tray,
    // which the Day view does not render at all — on `?view=day` the only
    // element carrying it is `ReadyToPromoteTray`, accepted abstracts that are
    // not sessions yet. So the spotlight framed the promotion panel while the
    // card described the column beside it, and the "three accepted talks" it
    // counts were nowhere near the box it was pointing at.
    anchor: named("complementary", "Unscheduled sessions"),
    // Right, not left. Both trays live against the leading edge, so a card
    // opening leftward can only ever be clamped to the 12px margin — on top of
    // the navigation rail, and over the panel it is describing.
    placement: "right",
  },
  {
    id: "grid.place",
    chapter: "the-grid",
    kind: "act",
    desktopOnly: true,
    title: "Put Voice Agents Under 300ms at 10:15.",
    body: "Open it from the tray and give it the Main Stage on day one at 10:15. Naming the slot matters; a tutorial that says “somewhere” earns a shrug.",
    route: at("/agenda", { view: "day" }),
    anchor: named("dialog", "Edit session"),
    spotlight: false,
    objective: world("sessionsScheduled", "increased"),
    hint: "Click the session in the Unscheduled tray to open its editor.",
  },
  {
    id: "grid.trap",
    chapter: "the-grid",
    kind: "observe",
    desktopOnly: true,
    title: "The Conflicts badge just moved.",
    body: "Main Stage was already busy at 10:15. Openboard noticed before your speakers did, and long before the programme went to print.",
    route: at("/agenda", { view: "day" }),
    anchor: tourIdAnchor("agenda.conflicts-tab"),
    placement: "bottom",
  },
  {
    id: "grid.open-conflicts",
    chapter: "the-grid",
    kind: "act",
    desktopOnly: true,
    title: "Open Conflicts.",
    body: "Room, speaker and track collisions, all computed from the same rule that draws the badge. A back-to-back pair is not one of them.",
    anchor: tourIdAnchor("agenda.conflicts-tab"),
    placement: "bottom",
    objective: goneTo("/agenda", { view: "conflicts" }),
  },
  {
    id: "grid.resolve",
    chapter: "the-grid",
    kind: "act",
    desktopOnly: true,
    title: "Fix it.",
    body: "Move yours, or move the other one. The verdict is computed server-side, so the badge, the grid and this list cannot disagree with each other.",
    route: at("/agenda", { view: "conflicts" }),
    anchor: css(".agenda-conflict-row"),
    placement: "bottom",
    objective: world("conflictCount", "decreased"),
    reward: { emoji: "🗓", line: "Two rooms, one time, zero apologies to write.", drops: 18 },
  },
];

const GO_LIVE: readonly TourStep[] = [
  {
    id: "live.publish",
    chapter: "go-live",
    kind: "act",
    title: "Publish the agenda.",
    body: "Until now not one row of this was visible outside your team. Select sessions in List view and publish them.",
    route: at("/agenda", { view: "list" }),
    anchor: tourIdAnchor("agenda.publish"),
    placement: "top",
    objective: world("publishedSessions", "increased"),
    // Not "tick the header checkbox" — two of the tray's three talks are
    // still unscheduled at this point (only Chapter 7's `grid.place` gets
    // placed), and selecting them here guarantees the validation error that
    // blocks this exact objective.
    hint: "Tick the sessions that already have a room and a time, then press Publish selected. Anything still in the tray needs to be placed first.",
  },
  {
    id: "live.public",
    chapter: "go-live",
    kind: "act",
    title: "Go and look at it from outside.",
    // The card's own button, not the sidebar link: the body says "this
    // opens", and the thing it names has to be the thing the player presses.
    // `via: "self"` is the only objective that fits — the new tab is a
    // different document, so no world fact and no route change can observe it.
    action: { label: "Open it", href: "/e/:eventSlug/agenda", newTab: true },
    body: "This opens your public schedule in a new tab. It is edge-cached, so give it a few seconds to catch up — that is the deal you get in exchange for it being fast.",
    anchor: named("link", "View public event"),
    placement: "right",
    objective: { via: "self" },
  },
  {
    id: "live.embed",
    chapter: "go-live",
    kind: "act",
    title: "Turn on the Agenda embed.",
    body: "One auto-resizing iframe that any CMS on earth can paste. The snippet appears the moment the embed is enabled.",
    route: at("/embeds"),
    anchor: css(".embed-enable-control"),
    placement: "bottom",
    objective: world("embedEnabled", "changed"),
    reward: { emoji: "🚀", line: "Your schedule, on somebody else's website." },
  },
];

const MISSION_CONTROL: readonly TourStep[] = [
  {
    id: "mission.templates",
    chapter: "mission-control",
    kind: "act",
    title: "Open the Templates tab.",
    // Eleven, not fourteen. Fourteen is the size of `TEMPLATE_KEYS`, three of
    // which are account mail — password reset, address verification, the
    // organization invitation — and none of those belong to an event or appear
    // on this tab. A player who counts finds eleven. The reminder ladder moved
    // to the step that actually opens it.
    body: "Eleven templates ship with every event, and every word a speaker ever reads from you comes out of one of them.",
    route: at("/communications", { tab: "reminders" }),
    anchor: css("#communications-tab-templates"),
    // Right, not the default bottom (#716). This step opens on the Reminders
    // tab so its own copy — "eleven templates" — can point at the Templates
    // tab next to it, but a card dropped below the tab strip landed square on
    // the reminder ladder the Reminders panel was already showing, hiding the
    // very rungs the next couple of steps are about. The Templates tab sits
    // at the row's leading edge, so right (not left — see `grid.tray`) opens
    // into the gap beside the row instead of over the rungs beneath it.
    placement: "right",
    objective: goneTo("/communications", { tab: "templates" }),
  },
  {
    id: "mission.subject",
    chapter: "mission-control",
    kind: "act",
    title: "Change a subject line.",
    body: "Edit one and save it. Every send from here renders from your words, and the log keeps the exact version it used.",
    // Stated rather than inherited. A step with no route of its own borrows the
    // last one its chapter declared, and this chapter declared `?tab=reminders`
    // — so the only route this step knew about was the tab the player has just
    // left. "Take me there", offered whenever the editor is slow to mount,
    // would have walked them off the Templates tab the step is about.
    route: at("/communications", { tab: "templates" }),
    anchor: css(".template-editor"),
    objective: world("templateUpdatedAt", "changed"),
  },
  {
    id: "mission.reminders",
    chapter: "mission-control",
    kind: "act",
    // Same reason, and one worse: inherited, this step's way back was the very
    // URL its objective is waiting for, so "Take me there" completed the step
    // instead of helping with it.
    route: at("/communications", { tab: "templates" }),
    title: "Open Reminders.",
    // One ladder with four rungs, which is what the tab draws: a heading, then
    // 7 days before, 1 day before, 1 day after, 7 days after. "Four ladders"
    // had the player looking for three more.
    body: "One ladder, four rungs, and it is why Victor was nudged about that overdue travel form. It runs on this demo for real, and every message it writes lands in the log as skipped.",
    anchor: css("#communications-tab-reminders"),
    placement: "bottom",
    objective: goneTo("/communications", { tab: "reminders" }),
    reward: { emoji: "📡", line: "Automated, logged, and still nowhere near a real inbox." },
  },
];

/**
 * The curtain call.
 *
 * The organizer is allowed to be done: leaving early through "Finish the tour
 * for good" still lands here, because skipping a tutorial is not a failure
 * state and a curtain call is cheap.
 */
const CURTAIN_CALL: readonly TourStep[] = [
  {
    id: "curtain.done",
    chapter: "curtain-call",
    kind: "beat",
    presentation: "modal-wide",
    title: "You just ran a conference.",
    body: "A form published. Decisions queued. A scheduling conflict caught and killed. An agenda live on the public web. And zero emails to eighteen people who do not exist.",
    route: at("/dashboard"),
    // Design §5.4's first hand-off nudge, and the only one that lands at the
    // moment of maximum intent. The other two — the demo ribbon and the
    // organization home's lead-with-create — are behind this modal; asking
    // here is what makes them a reminder rather than the only invitation.
    action: { label: "Create my real event", href: "/organizations/:organizationId/onboarding?mode=create&from=demo" },
    continueLabel: "Keep playing in the demo",
    reward: { emoji: "🎉", line: "Nothing in here is read-only. Rename it, break it, delete it.", drops: 28 },
  },
];

/* --- side quests -------------------------------------------------------- */

/**
 * Reachable at any time from the coach card's tray, for as long as the tour is
 * running — a finished tour has no surface that offers them, so the only way
 * back to an unfinished quest today is the ribbon's *Restart tour*. Their ids
 * carry the `quest.` prefix because
 * that is how the server tells an objective from a side quest when it counts
 * the finale's "17 of 19 objectives · 2 side quests".
 *
 * Finishing one returns the organizer to wherever the golden path was, not to
 * the next quest: a detour is not a queue entry.
 */
const SIDE_QUESTS: readonly TourStep[] = [
  {
    id: "quest.outbox",
    chapter: "the-decision",
    kind: "observe",
    optional: true,
    title: "Read the mail you did not send.",
    // Same restoration as `decide.outbox`, and the same de-counting (#709):
    // the seed writes nine backdated rows, but the live reminder sweeper adds
    // roughly fifty more `task_assigned`/`task_reminder` rows to this log, so
    // "nine" is falsifiable by counting the very screen the card points at.
    // And the same rule as there (#679): no claim to a render, because the
    // dispatcher stops a demo send before one.
    body: "The oldest rows are messages the world was built with, plus everything this tour queued — and every one of them was logged and then skipped, with the reason on the row.",
    route: at("/communications", { tab: "log" }),
    anchor: css("#communications-tab-log"),
    placement: "bottom",
  },
  {
    id: "quest.blind-review",
    chapter: "judgement",
    kind: "observe",
    optional: true,
    title: "Look at how blind review is set up.",
    body: "Round 2 hides the proposal's authors from its reviewers and the reviewers from each other. It is a pair of settings, not a separate product.",
    route: at("/evaluation"),
    // No anchor, deliberately. It pointed at `.reviewer-progress` — the
    // Reviewers column, which lists who is assigned and how far along they
    // are, and is evidence for nothing this card says. The two settings it
    // *is* about are printed in the Window cell of the second round, and
    // `.plan-window` resolves to the first round's cell, which is not blind.
    // A card in the centre of the right page beats a spotlight on the wrong
    // control: the step is "have a look", and the page is the answer.
  },
  {
    id: "quest.chase-a-speaker",
    chapter: "field-trip",
    kind: "observe",
    optional: true,
    title: "Chase a speaker, nicely.",
    body: "One assignment is thirty days overdue, which means its whole reminder ladder has already run. Here is what each speaker still owes you.",
    route: at("/tasks"),
  },
  {
    id: "quest.speaker-resources",
    chapter: "field-trip",
    kind: "act",
    optional: true,
    // The handbook is not the draft — provisioning publishes it, along with
    // travel & reimbursement, and leaves *Recording release* in draft. A quest
    // titled "publish the speaker handbook" therefore named the one row on the
    // page that already carried a Published badge, while its own hint sent the
    // player to a different one. `script.test.ts` holds the title to whichever
    // page the dataset leaves unpublished.
    title: "Publish the recording release.",
    body: "Three resource pages exist and one of them is still a draft. Speakers see published pages in their portal and nothing else.",
    route: at("/resources"),
    objective: world("resourcePagesPublished", "increased"),
    hint: "Open the page still badged Draft, tick Published, and save it.",
  },
  {
    id: "quest.vocabulary",
    chapter: "command-deck",
    kind: "observe",
    optional: true,
    title: "Speak your own language.",
    body: "Tracks can be themes, rooms can be stages. Rename them here and every screen, export and public page follows the word you chose.",
    route: at("/settings"),
  },
  {
    id: "quest.bulk-message",
    chapter: "mission-control",
    kind: "observe",
    optional: true,
    title: "Write to a whole segment at once.",
    body: "Pick a segment, compose once, preview against a real recipient. Composing is entirely safe here — sending is suppressed like everything else.",
    route: at("/communications", { tab: "bulk" }),
    anchor: css("#communications-tab-bulk"),
    placement: "bottom",
  },
  {
    id: "quest.auto-place",
    chapter: "the-grid",
    kind: "act",
    optional: true,
    desktopOnly: true,
    title: "Auto-place the rest of the tray.",
    body: "It fills the gaps it can prove are free and leaves the rest alone. Anything it cannot place stays in the tray with a reason.",
    route: at("/agenda", { view: "day" }),
    anchor: tourIdAnchor("agenda.auto-place-tray"),
    // Right, not left, and for the same reason `grid.tray` documents above:
    // the tray lives against the leading edge, so a card opening leftward
    // only ever clamps to the 12px margin — on top of the navigation rail
    // (#716).
    placement: "right",
    objective: world("sessionsScheduled", "increased"),
  },
  {
    id: "quest.submit-a-proposal",
    // `observe`, not `act`, and the body names the real blocker.
    //
    // The public CFP wizard's first step is a six-digit code delivered by
    // `portal_login`, and rail 2 suppresses every send from a demo event —
    // the *event*, not the recipient, so the organizer's own real address gets
    // nothing either. Outside production the code is handed back inline
    // (`EMAIL_FALLBACK_UI`), which production forbids. An `act` armed on
    // `submissionsTotal` would therefore poll for ten minutes and yield, and
    // the copy this replaced blamed the fabricated speakers' addresses — a
    // reason that was not the reason, and one `user-facing-copy-regressions`
    // now refuses outright. Walking the wizard is worth seeing; the round trip
    // is honestly only completable on a local or preview build.
    chapter: "the-call",
    kind: "observe",
    optional: true,
    title: "Walk your own call for speakers.",
    body: "Open the live form and go through the real public wizard. Nothing here can send you the sign-in code — the demo event suppresses every message — so the round trip only finishes outside production.",
    route: at("/forms"),
    anchor: css(".form-list-card"),
  },
];

/* --- the script --------------------------------------------------------- */

export const TOUR_STEPS: readonly TourStep[] = [
  ...COLD_OPEN,
  ...COMMAND_DECK,
  ...THE_CALL,
  ...TRIAGE,
  ...JUDGEMENT,
  ...THE_DECISION,
  ...FIELD_TRIP,
  ...THE_GRID,
  ...GO_LIVE,
  ...MISSION_CONTROL,
  ...CURTAIN_CALL,
  ...SIDE_QUESTS,
];

export const TOUR_SCRIPT = {
  chapters: TOUR_CHAPTERS,
  steps: TOUR_STEPS,
} as const;

/** The cursor a freshly provisioned demo starts on — and `drizzle/0044`'s two column defaults. */
export const TOUR_FIRST_CHAPTER_ID = "cold-open";
export const TOUR_FIRST_STEP_ID = "coldopen.hello";

const BY_ID = new Map(TOUR_STEPS.map((step) => [step.id, step]));

/** Addressed through a `Map` built once: `noUncheckedIndexedAccess` makes the array form a lie. */
export function tourStepById(stepId: string): TourStep | null {
  return BY_ID.get(stepId) ?? null;
}

export function tourChapterById(chapterId: string): TourChapter | null {
  return TOUR_CHAPTERS.find((chapter) => chapter.id === chapterId) ?? null;
}

/**
 * Steps whose world comes out of a *later* phase than their own chapter's.
 *
 * `CHAPTER_PHASE` is keyed per chapter, which is right for the arc — a chapter
 * is written by one phase and dropped whole. Side quests break that: a quest
 * borrows an arc chapter for its place in the tray, not for its payload, and
 * two of them read a world their chapter's phase never writes. Left to the
 * chapter rule they survive a "Continue without it" that removed the very
 * thing they point at — the tray goes on offering "Publish the speaker
 * handbook" and routes to an empty `/resources`.
 *
 * Only overrides belong here; a step whose chapter already names the right
 * phase is covered by `unavailableTourChapters`.
 */
const STEP_PHASE: Readonly<Record<string, DemoProvisionPhase>> = {
  // `the-decision` is written by `submissions_a`; the delivery log is `comms`.
  "quest.outbox": "comms",
  // `field-trip` is written by `portal`; the handbook pages are `resources`.
  "quest.speaker-resources": "resources",
};

/**
 * The context ids a step interpolates into its route or its route objective.
 *
 * Derived from the templates rather than listed by hand: a `:cfpFormId` added
 * to a new step's path is a new dependency the moment it is written, and a
 * second list would only be the place someone forgets.
 */
function contextKeysUsedBy(step: TourStep): readonly TourContextKey[] {
  const templates: string[] = [];
  const collect = (route: { path: string; query?: Readonly<Record<string, string>> }) => {
    templates.push(route.path, ...Object.values(route.query ?? {}));
  };
  if (step.route) collect(step.route);
  if (step.objective?.via === "route") collect(step.objective);
  return TOUR_CONTEXT_KEYS.filter((key) => templates.some((template) => template.includes(`:${key}`)));
}

/**
 * The steps this particular demo world can actually run.
 *
 * Two reasons a step cannot, both of which used to route the player at a page
 * with nothing on it:
 *
 * 1. Its payload came from a phase "Continue without it" skipped — the
 *    per-step counterpart to `unavailableTourChapters`, for the quests whose
 *    chapter cannot speak for them.
 * 2. Its route needs a context id this world does not have.
 *    `editableFormId` is the live one: it is "the first form with no non-draft
 *    submission", so it goes null in ordinary free play as soon as every form
 *    on the event has been answered — nothing to do with a skipped phase — and
 *    `call.add-question` would then navigate to `/events/{id}/forms/` and arm
 *    a `formFields` objective with no form to add a field to.
 *
 * Chapter-level availability deliberately stays out of this: the engine's
 * `visibleTourSteps` drops those, and `skipNotices` needs to diff the full
 * script against what survived so a dropped chapter gets its apology. These
 * steps get none, which is right — an absent tray entry owes no explanation,
 * and there is no honest line to write about a form that does not exist.
 */
export function supportedTourSteps(
  skippedAtPhase: DemoProvisionPhase | null,
  /**
   * Every context key, not a partial. A missing key reads identically to an
   * empty one — "this world cannot run that step" — so `Partial` let both
   * hosts hand this the *server reader's* context, which carries the event's
   * slug and never its id, and silently lose every step routed under
   * `/events/:eventId`: all but a handful of the script. Requiring the whole
   * map makes that a type error rather than a tutorial with six chapters
   * missing.
   */
  context: Readonly<Record<TourContextKey, string | null>>,
): readonly TourStep[] {
  // Requiring the whole map makes the wrong context a type error; it cannot
  // make an *empty* event id anything but a per-step drop, and every route in
  // the script is anchored on `/events/:eventId`. Filtered one step at a time,
  // that left seven orphans strung across five chapters and ending, with no
  // successor, half-way through Mission Control — where the engine reads "no
  // next step on the arc" as "the player finished" and retires the tutorial
  // for good. There is no honest partial tour without an event id, so the
  // answer is none of it.
  //
  // An empty list is a sentinel for the host, not a mount guard: the layout
  // still builds a bootstrap around it, so the layer mounts, draws nothing —
  // it has no step to render, which is the one case it renders `null` for —
  // and its started-effect still records the cursor as `active`. Both call
  // sites take the id from the `/events/:eventId` route segment, so an empty
  // one cannot reach here today; this is defence against a caller handing
  // over a context that has lost it, where a tour that shows nothing beats
  // one that ends mid-chapter and marks itself finished.
  if ((context.eventId ?? "") === "") return [];
  const stoppedAt = skippedAtPhase === null ? -1 : DEMO_PROVISION_PHASES.indexOf(skippedAtPhase);
  return TOUR_STEPS.filter((step) => {
    const phase = STEP_PHASE[step.id];
    if (phase && stoppedAt >= 0 && DEMO_PROVISION_PHASES.indexOf(phase) >= stoppedAt) return false;
    return contextKeysUsedBy(step).every((key) => (context[key] ?? "") !== "");
  });
}
