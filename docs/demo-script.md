# Openboard walkthrough

There are two ways to see the product end to end, and they cover different ground.

**The guided tour is the fast one.** Any organizer can have Openboard build them a complete,
fictional conference — *AI Engineer World's Fair* — and then walk them through running it, with
every step verified against the real database. Nothing in that world can email a living person.
Ten minutes for the required arc, about thirteen for all of it. Start it from
`/organizations/{organizationId}/onboarding?mode=demo`, or from the command palette
(<kbd>⌘K</kbd> → *Explore a demo event*), or from the **Explore a demo event** button on your
organization home. See §1.

**The manual walkthrough below is the thorough one.** It runs against the seeded sandbox
event, uses your own hands rather than the tutorial's objectives, and covers the surfaces the
tour deliberately skips. See §2. If you are demoing to somebody else, run §1; if you are
verifying a build, run §2.

---

## 1. The guided tour

### What the demo event is

One event per organization, built at runtime by the product's own writers — the same
`createEventIn`, `createSubmissionIn`, `saveSessionIn` and evaluation writers a customer's real
event uses. It is not a fixture and it is not read-only: rename it, delete sessions, publish it,
invite a co-organizer. It is an ordinary event with four differences, all of them visible:

| | |
|---|---|
| **It is labelled.** | A `Demo` badge in the topbar, on the event switcher, and on the organization home card. A *"Sample event · built with Openboard"* ribbon on the public pages, which also carry `robots: noindex, nofollow`. |
| **It cannot send mail.** | Every fabricated address ends `@…demo.invalid` (RFC 2606 — no DNS, anywhere), *and* the dispatcher throws `SkipEmail("demo event — mail is never delivered")` on `events.is_demo` with no exceptions. Provisioning writes no `queued` outbox row at all. Mail the tour queues is rendered, logged, and skipped — which is Chapter 5's punchline, not a workaround. |
| **It is free.** | It does not consume a plan slot and is not metered. An organization at 5 of 5 events can still take the tour; its billing page reads *"5 of 5"* plus *"1 demo event (not counted toward your plan)"*. |
| **It is disposable.** | Reset rebuilds it at the same id. Delete (owner only, typed confirmation) removes it and everything under it. Neither touches a real event: `is_demo = true` sits inside the DELETE's own predicate. |

### Running it

1. **Start.** A brand-new organization is offered the choice before the setup wizard: *Explore a
   finished conference* or *Set up my real event*, plus *Skip both*. An organization that already
   runs events is never interrupted — use `?mode=demo` to ask for the tour by name.
2. **Watch it build.** Ten phases, one HTTP request each, narrated line by line: the venue and
   tracks, eighteen speakers who do not exist, the call for speakers, twenty-four proposals, a
   review queue, a schedule with two problems planted in it, the speaker portal, resources, and
   the outbox. Roughly 430 rows. If a phase will not run, the screen offers *Try that step again*
   (idempotent, so a retry is free) or *Continue without it*.
3. **Take the tour, or do not.** The cold open offers *Let's go* and *I'll poke around myself*.
   Declining keeps the whole world and leaves a resume pill; it is not a cost.
4. **Play.** Eleven chapters. Objectives are verified against server state rather than clicks, so
   finishing one in a second tab, on your phone, after a refresh, or by a route nobody scripted all
   count. <kbd>Esc</kbd> pauses with no dialog and no loss; every step has *Skip this* and every
   chapter has *Skip this chapter*.

### The chapters

| # | Chapter | What you actually do |
|---|---|---|
| 0 | Cold open | Read three numbers the product renders within ninety seconds. |
| 1 | Command deck | The attention queue, the live SQL stat tiles, <kbd>⌘K</kbd>, and the Speaker Tracking tab. |
| 2 | The call | Add a question to the lightning-talk form (the main call is locked, because two dozen people have already answered it — that lock is the lesson), see conditional visibility fire in the organizer preview, then publish an immutable version. |
| 3 | Triage | Open a proposal, read answers pinned to the version its speaker actually saw, and filter the queue. |
| 4 | Judgement *(optional)* | Two rounds, weighted criteria, Round 2 blind. Score one — nothing is pre-scored on your behalf. |
| 5 | The decision | Move three to the accept queue, read the preflight, press Notify, then watch every one of them land in the delivery log as **Skipped**, reason *"demo event — mail is never delivered"*. |
| 6 | Field trip *(optional)* | Real impersonation into a speaker's portal, in a new tab. The objective completes over there, before you switch back. |
| 7 | The grid | Place a session, cause a collision on purpose, watch the Conflicts badge notice, and fix it. |
| 8 | Go live | Publish the agenda — the first row anything outside your team can see — then look at the public page and turn on the embed. |
| 9 | Mission control *(optional)* | Templates, a subject line, and the reminder ladder that nudged an overdue speaker three times without sending anything. |
| — | Curtain call | What you did, counted from the live database, and the way out into a real event. |

Eight side quests sit in the coach card's tray and stay available afterwards: submit a proposal
yourself, read the mail you did not send, blind review, chase a speaker, speaker resources, rename
the vocabulary, bulk-message a segment, and auto-place.

### Afterwards

The demo stays. **Start from my demo's setup** on step 1 of the real-event wizard copies exactly
its vocabulary and one form's structure — tracks, rooms, formats, tags, fields, conditional rules
— and nothing else. No contacts, no submissions, no sessions, no outbox rows.

### Known limits

- **Below 860 px** the agenda chapters are skipped with an explicit apology rather than silently.
- **Reviewers never see the tour.** It is organizer-and-above, and reviewers get `children` only.
- **The public CFP round trip** cannot complete in production: the one-time code is emailed, and
  demo mail is suppressed. Side quest Q1 says so in as many words and suggests your own address.

---

## 2. The manual walkthrough

Every step below runs against a real Postgres database. Run the walkthrough in either
environment; the steps are identical:

- **Deployed preview** — <https://sb-web-preview.yi-ding.workers.dev>. Mail sends from the verified
  domain to its one-address allowlist; for every other address, nothing is delivered at all and the
  page explicitly surfaces the same one-time activation link or OTP under **Test environment**.
- **Local, database-backed** — `pnpm dev` against a Neon/Postgres branch you own, seeded with
  `pnpm seed`. See `docs/development.md` *Getting started* and `docs/manual-test-plans.md` §0.2 (Env A).
  With `EMAIL_MODE=log` and `EMAIL_FALLBACK_UI=1` (both local defaults) the OTP and magic link
  surface in the login UI itself, so no inbox is needed. Neither variable is permitted in
  production.

**Before you start**

- **Admin sign-in** is a real account. Create one with `pnpm admin:bootstrap`
  (see `docs/development.md` *Getting started*); the seed reports `organizer@openboard.dev` /
  `reviewer@openboard.dev` and the passwords you passed it.
- **The seeded event** is *AI.Engineer Sandbox — NYC* (`ai-engineer-sandbox-event`), plus
  *Empty Conf* (`empty-conf`), which exists to show empty states. This is the **seed**, not the
  per-organization demo event of §1: it carries deliberate hostile probes (an XSS payload, an
  RTL override, a 255-character title) that a customer must never meet, and it is shared by the
  e2e suite.
- **Public form URLs use the real form UUID** — `/submit/<eventSlug>/<form UUID>`; a slug like
  `technical-talks` 404s. Get the URL from the admin **Forms** list: each row has a copy-link
  and an open-public-form action.
- **Calendar feeds** need a real signed token from a portal invite (`/cal/<token>`);
  `/cal/demo` is not a valid token.

### Steps

1. **Dashboard.** Open `/events`, choose **AI.Engineer Sandbox — NYC**, and review the
   dashboard: an aggregated server endpoint over the SQL reporting views, with an
   attention-first queue.
2. **Build a form.** Open **Forms**, create a form, add a question, configure conditional
   visibility, and publish; then copy its public link from the list. The seeded
   *Speak at AI.Engineer Sandbox* form shows the structural lock (mapped questions such as
   Title and Email cannot be restructured) and the immutable per-save snapshot. Note that a form
   with any non-draft submission refuses structural edits entirely — that is the same lock the
   tour's Chapter 2 teaches.
3. **Submit a proposal.** Open the public CFP link and walk the wizard (account → submission
   → speakers → review): email +
   emailed OTP (or the explicit demo code in preview/local login UI), a server-persisted draft, then
   submit. Choose **Format → Workshop** to watch the conditional *Workshop duration* question
   appear and disappear.
4. **Edit until close.** Sign into the speaker portal as that submitter
   (`/portal/<eventSlug>`), open the new pending proposal under **Submissions**, and choose
   **Edit your proposal** to change an answer. The CTA disappears once the submission is
   decided or the form closes.
5. **Review and decide.** Back in admin, open **Abstracts**, open the new proposal and inspect
   **Answers**; assign it to a round under **Evaluation** and score it in **Review queue**
   against its pinned snapshot; choose **Move to accept queue**, then press **Notify** in the
   decision bar and confirm with **Queue decision emails**. The notification is enqueued in the
   transactional outbox and sent by the cron-driven dispatcher — the one place that calls Resend.
6. **Walk the speaker's side.** In **Speakers**, open a speaker and choose
   **Open portal as {name}** — real admin impersonation, not a fixture switch. Update the
   profile, upload a headshot or a file to a task, and complete a task.
7. **Schedule it.** In **Agenda**, take an accepted-but-unscheduled session from the tray,
   assign a time and room, and watch the conflict indicator; conflicts are computed
   server-side, so the tab badge, grid and Conflicts view quote the same verdict. Try
   **Auto-place** in the unscheduled tray for a conflict-safe slot.
8. **Publish it.** Open `/e/<eventSlug>/agenda` and `/e/<eventSlug>/speakers` — server
   rendered from the `published_*` views (nothing unpublished can leak), edge-cached, and
   embeddable. Open **Embeds** and copy either iframe. (`/e/<eventSlug>/schedule` still works
   but is a redirect to `/agenda`; link the canonical path.)
9. **Communicate.** In **Communications**, inspect the delivery log, edit a sanitized
   template, review the reminder ladder, and check suppressions/deliverability. Calendar
   feeds live at `/cal/<token>` from a real invite.

Everything you change here is written to the database, so it persists across browsers and
sessions. To start over locally, re-run `pnpm seed --wipe`.
