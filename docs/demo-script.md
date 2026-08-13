# Openboard judge walkthrough

There is **one world**: every step below runs against a real Postgres database. The
credential-free browser demo — `Open demo` on `/`, the localStorage store, the fixed OTP
`424242`, `maya@ai.engineer`, and **Reset demo** — was deleted from the codebase on
2026-08-12 and no longer exists in any environment. Steps that used to be walked "in the
browser demo" are walked here against the server.

Run the walkthrough in either environment; the steps are identical:

- **Deployed preview** — <https://sb-web-preview.yi-ding.workers.dev>. OTPs are real emails
  (the preview sends from the verified domain behind a one-address allowlist).
- **Local, database-backed** — `pnpm dev` against a Neon/Postgres branch you own, seeded with
  `pnpm seed`. See `docs/development.md` *Getting started* and `docs/manual-test-plans.md` §0.2 (Env A).
  With `EMAIL_MODE=log` and `EMAIL_FALLBACK_UI=1` (both local defaults) the OTP and magic link
  surface in the login UI itself, so no inbox is needed. Neither variable is permitted in
  production.

**Before you start**

- **Admin sign-in** is a real account. Create one with `pnpm admin:bootstrap`
  (`docs/admin-bootstrap.md`); the seed reports `organizer@openboard.dev` /
  `reviewer@openboard.dev` and the passwords you passed it.
- **The seeded event** is *AI.Engineer Sandbox — NYC* (`ai-engineer-sandbox-event`), plus
  *Empty Conf* (`empty-conf`), which exists to show empty states.
- **Public form URLs use the real form UUID** — `/submit/<eventSlug>/<form UUID>`; a slug like
  `technical-talks` 404s. Get the URL from the admin **Forms** list: each row has a copy-link
  and an open-public-form action.
- **Calendar feeds** need a real signed token from a portal invite (`/cal/<token>`);
  `/cal/demo` is not a valid token.

`plan/status.md` remains the evidence ledger: it — not this script — is the record of which
steps have been *demonstrated* on the deployed preview versus merged and exercised locally.

## Steps

1. **Dashboard.** Open `/events`, choose **AI.Engineer Sandbox — NYC**, and review the
   dashboard: an aggregated server endpoint over the SQL reporting views, with an
   attention-first queue.
2. **Build a form.** Open **Forms**, create a form, add a question, configure conditional
   visibility, and publish; then copy its public link from the list. The seeded
   *Speak at AI.Engineer Sandbox* form shows the structural lock (mapped questions such as
   Title and Email cannot be restructured) and the immutable per-save snapshot.
3. **Submit a proposal.** Open the public CFP link and walk the five-step wizard: email +
   emailed OTP (or the fallback code in the login UI locally), a server-persisted draft, then
   submit. Choose **Format → Workshop** to watch the conditional *Workshop duration* question
   appear and disappear.
4. **Edit until close.** Sign into the speaker portal as that submitter
   (`/portal/<eventSlug>`), open the new pending proposal under **Submissions**, and choose
   **Edit your proposal** to change an answer. The CTA disappears once the submission is
   decided or the form closes.
5. **Review and decide.** Back in admin, open **Abstracts**, open the new proposal and inspect
   **Answers**; score it under **Evaluation** against its pinned snapshot; accept it; then
   **Notify accepted speakers**. The notification is enqueued in the transactional outbox and
   sent by the cron-driven dispatcher — the one place that calls Resend.
6. **Walk the speaker's side.** In **Speakers**, open a speaker and choose
   **Open portal as {name}** — real admin impersonation, not a fixture switch. Update the
   profile, upload a headshot or a file to a task, and complete a task.
7. **Schedule it.** In **Agenda**, take an accepted-but-unscheduled session from the tray,
   assign a time and room, and watch the conflict indicator; conflicts are computed
   server-side, so the tab badge, grid and Conflicts view quote the same verdict. Try
   **assisted placement** for a conflict-safe slot.
8. **Publish it.** Open `/e/<eventSlug>/schedule` and `/e/<eventSlug>/speakers` — server
   rendered from the `published_*` views (nothing unpublished can leak), edge-cached, and
   embeddable. Open **Embeds** and copy either iframe.
9. **Communicate.** In **Communications**, inspect the delivery log, edit a sanitized
   template, review the reminder ladder, and check suppressions/deliverability. Calendar
   feeds live at `/cal/<token>` from a real invite.

Everything you change here is written to the database, so it persists across browsers and
sessions. To start over locally, re-run `pnpm seed --wipe`.
