# Openboard experience design — fewer steps, surfaced answers, visual appeal

**Created:** Aug 10, 2026 · **Companions:** [`design-system.md`](design-system.md) (colour and
typography tokens), [`../product-roadmap.md`](../product-roadmap.md) Phase P6 (the modularized
feature catalog, M56–M60).

This document records the interaction-design principles for the admin app, the speaker portal
and the public pages, plus the "surprise & delight" catalog those principles motivate. The
principles bind new UI work the way `design-system.md` binds colour: follow them or amend this
document first. The catalog is sequenced work, not aspiration — each item is modularized in the
roadmap's Phase P6 and obeys the same recovery-gate precedence as everything else.

---

## The organizing law

**Every screen computes the user's next action, puts it first, and lets everything else
recede.** The three goals this document serves are that law viewed from three sides:

- *Fewer steps* means shortening the distance from the computed answer to the click.
- *Surfacing* means computing the answer server-side instead of making the user assemble it
  from tabs.
- *Visual appeal*, in a dense operational tool, mostly **is** hierarchy — a screen looks good
  when the important thing is unmistakable and the rest is quiet.

The second structural fact the design leans on: **an event has a lifecycle** — CFP open →
review → decisions → onboarding/scheduling → live → wrap — and at any moment each role has one
dominant job. Surfaces reweight what they lead with by phase (same components, reordered), which
is how the product feels like it knows where you are without any inference machinery.

## Fewer steps — interaction patterns

1. **Wire the command palette that is already promised.** The admin topbar renders a
   "Search anything ⌘K" trigger (`features/shell/admin-shell.tsx`) that is currently
   decorative. Real behavior: jump to any speaker/submission/session by name or code, plus
   verbs ("assign reviewers…", "email overdue speakers…"). The sidebar stays as the map; the
   palette becomes the road. (M58)
2. **Act where you look — slide-over panels over page navigations.** Admin flows are
   list-heavy. Opening submission detail, speaker detail, and scoring in a slide-over with the
   list still visible behind — with keyboard next/prev — turns "review 40 abstracts" from ~120
   navigations into one continuous flow. The existing `data-table` is the mount point. (M57)
3. **Bulk verbs on every list.** Decisions, reviewer assignment, reminders, and task nudges are
   inherently batch operations: checkbox selection + one sticky action bar pattern
   ("Accept 12 · Assign reviewer · Send reminder"), reused identically across abstracts,
   speakers, and tasks. (M57)
4. **Deep links land on the action.** `features/portal/speaker-deep-links.ts` exists — every
   email lands the speaker *inside* the specific task, never on the portal home. For a
   magic-link product the inbox is the navigation; a link that lands one click short of the
   action wastes the mechanism. Admin digests likewise link to the pre-filtered view. (M59)
5. **Kill steps with defaults, not just links.** The CFP wizard resumes the server-persisted
   draft on arrival (not behind a prompt); the agenda opens on the first event day with the
   unscheduled tray shown only when non-empty; forms pre-fill from the contact record. Each
   removes a decision, which is cheaper than removing a click.

## Surfacing — exactly what the user needs

1. **The dashboard is an attention queue, not a report.** Lead with the ranked list of what is
   blocking the event now ("5 abstracts unreviewed 7+ days · 3 accepted speakers missing
   headshots · 2 room conflicts Thursday"), each item linking to the pre-filtered view with the
   bulk bar pre-armed — the pre-arming is M57's deliverable; until M57 lands each link opens
   the plain filtered list, so M56 and M57 stay independently shippable. KPI tiles and the
   donut move below the fold. The test for every dashboard
   element: *can the user click it and act?* If not, demote it. (M56; extends M38's
   attention-strip intent.)
2. **Phase-aware emphasis.** During CFP, submission velocity leads; during review, reviewer
   progress and stragglers; after decisions, onboarding-task completion and the confirmation
   mix; event week, today's schedule and conflicts. Reordering, not new widgets. (M56)
3. **Live counts as ambient status.** The sidebar count badges (currently a hardcoded
   `count: 12` in `admin-shell.tsx`) become real queries scoped to *actionable* counts —
   unreviewed, not total — so the nav itself is a status board. (M56)
4. **Portal home leads with one next step.** Speakers visit rarely and briefly. The home is not
   a grid of equal widgets: a single hero card carries the most urgent incomplete item ("Upload
   your headshot — due Friday"), then My Sessions, then everything else quiet. When nothing is
   due, the hero becomes the celebration/status surface. (M59)
5. **Empty states teach the next step.** Every empty list names what creates content here and
   offers the button ("No sessions yet — Promote accepted submissions →"). Cheapest onboarding
   in the product, and the safest place to spend charm. (M60)

## Visual appeal

1. **Two densities, deliberately.** Admin surfaces are compact and information-dense — density
   *is* the operator aesthetic — while portal and public pages go generous: whitespace, large
   type, event imagery. The contrast makes each look intentional. This does not override
   `design-system.md`'s open density issue: its 10px floor and the planned coordinated re-scale
   stand; "compact" means tight layout, never sub-floor type.
2. **One accent, spent only on action and status.** The accent goes to the primary action and
   the attention strip; status stays on the fixed semantic chip set (`color-chip` is the
   enforcement point). Scarce color is trusted color.
3. **Hierarchy through the type ramp, not boxes.** No nested cards-in-cards; prefer the
   eleven-step size scale, whitespace grouping, and single hairline dividers. Dashboard
   numbers big, labels small and muted, no card chrome competing with content.
4. **Motion only at meaningful transitions.** Slide-overs easing in, a count ticking on change,
   the acceptance-moment celebration — nothing else animates. CSS transitions only; the
   Workers-Free bundle budget rules out animation libraries, which is also the better
   aesthetic call.
5. **The schedule is the beauty moment.** The time-grid is the one screen where visual craft is
   directly the product: clean hour gridlines, track-colored blocks with strong titles,
   conflicts as a red edge rather than dialogs. It is what appears in demos, embeds, and
   attendee shares — make it screenshot-worthy.

## Surprise & delight catalog

Delight in this category comes from the software visibly caring at an emotionally charged
moment, or quietly doing dreaded work. Everything below is a thin layer over plumbing that
already exists (ICS builder, outbox, R2, `detectConflicts()`, published views, deep links) —
that is the selection criterion, not a coincidence.

**Speakers** (highest emotional stakes):

- **The acceptance moment.** Celebratory first post-acceptance portal visit, and an
  auto-generated **"I'm speaking!" share card** — speaker headshot from R2, talk title, event
  branding — as an OG-tagged share page. Speakers want to announce; handing them the asset is
  pure delight and free marketing for the organizer. The card composes from the **accepted
  submission and contact data**, not `published_speakers_v` — that view joins through scheduled,
  published sessions and has no row at accept time. The share page is minted per speaker under
  an unguessable token and shows only speaker-submitted content (name, headshot, talk title);
  schedule details appear on it only once the session is published. (M59)
- **Calendar where they look.** My Sessions offers one-click add-to-calendar via the existing
  `/cal/[token]` feed and Google/Outlook deeplinks — M35 machinery, resurfaced. (M59)
- **Progress as momentum.** "2 of 5 done — your speaker page goes live when your bio and
  headshot are in" — the dashboard already computes this per speaker; show them their own
  slice. (M59)
- **Kind draft resurrection.** "Welcome back — you were on step 3, the deadline is in 4 days"
  on the CFP wizard, using the persisted draft. The countdown is the calendar-day distance to
  the **form's `closes_at`** in the event timezone (not `daysToEvent`, which counts to the
  event start and would overstate how long submissions stay open); omit it when `closes_at` is
  null. (M59)
- **A "what happens next" timeline.** Submitted ✓ → In review → Decisions by ⟨date⟩ on the
  portal, killing the #1 source of anxious speaker email. (M59)

**Organizers** (delight = dread removed):

- **Assisted conflict-safe placement** is already scoped as **M54** — it is the flagship
  organizer delighter and stays where it is.
- **Milestone acknowledgments.** CFP closed ("214 submissions from 31 countries"),
  all-decisions-sent, zero-conflicts-schedule — small dashboard moments that make the tool feel
  like a colleague. (M60)
- **The "ready to announce" bundle.** On schedule publish: embed snippet, public URLs,
  per-speaker share cards, pre-written announcement copy, in one place. Packaging over proven
  surfaces. (M60)
- **Reviewer-load fairness at a glance.** Assignments-per-reviewer mini-bars in evaluation,
  preventing the silent one-reviewer-gets-80-abstracts failure. (M56)

**Attendees:**

- **Zero-account personal itinerary** is already scoped inside **M53** (star sessions,
  localStorage, ICS export) and stays there.
- **"Happening now / up next."** During event days the public schedule auto-highlights the
  current slot using event-timezone math (`formatInZone`/`eventDayKey`). The highlight is
  computed **client-side with a periodic (~minutely) refresh** against the event's IANA
  timezone — never baked into server-rendered markup, because the page is edge-cached
  (`s-maxage`) and cached HTML would serve a stale slot. Sites that do this feel alive; ones
  that don't feel like PDFs. (M60)
- **Delightful empty and error states.** The 404, "schedule not yet published", empty search —
  a helpful redirect ("The schedule drops March 3 — here's the speaker gallery meanwhile")
  reads as craft. (M60)

## Constraints, stated once

1. **Recovery-gate precedence is unchanged.** While `status.md` §5 gates are open they order
   all work; P6 items ship only as thin layers over *server-backed* surfaces. Nothing in this
   document may be built onto a `useDemo()` component — that would grow the demo fork the
   roadmap is draining.
2. **Bundle budget.** No confetti, chart, or animation libraries; CSS and hand-rolled SVG only.
   Share-card rendering must not pull an image-rasterization library into the worker — prefer a
   styled share page with OG meta, or precomposed SVG.
3. **Existing invariants hold** — the single `<RichTextView>` `dangerouslySetInnerHTML` site,
   `time.ts` as the only date-library importer, the eight-function `withTx` audit, and the
   single-writer rules are unaffected by anything here.
