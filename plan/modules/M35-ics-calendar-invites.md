# M35 — ICS + calendar invites

| | |
|---|---|
| **Status** | IN PROGRESS — claimed by Codex for active recovery after M34 merged. The partial ICS/feed **STACK-DEMO** is merged; active scope is the contract-complete builder, durable invite state, dispatcher attachment wiring, tokenized calendar routes, and local lifecycle evidence. Real-inbox/deployed AC remain external evidence. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-F (Comms + Dashboard + Airtable + API) — feature folder `comms`, plus the public `/cal` routes. |
| **Scheduled** | **Sat PM: the canned real-inbox render check (step 2 — no app code required). Sun: the module proper + the full seeded lifecycle test (step 8).** Mon CP3 re-verifies only the end-to-end flow from a real scheduling action. |
| **Size** | M (≈half-day) |
| **Paths owned** | `src/features/comms/ics.ts`, `src/features/comms/ics.test.ts`, `src/features/comms/__fixtures__/*.ics`, `src/features/comms/server/invites.ts`, `src/app/cal/[token]/route.ts`, `src/app/cal/[token]/[sessionId]/route.ts`. Appends **only** its named export lines to `src/features/comms/index.ts` (owned by [M34](./M34-comms-outbox-dispatcher.md)). |

## Objective
A hand-rolled, dependency-free, UTC-`Z`-only RFC 5545 builder produces calendar invites that Gmail and Outlook render as **native invites** — `METHOD:REQUEST` on assign/change with a stable UID and monotonically increasing SEQUENCE (so a reschedule updates in place instead of duplicating), `METHOD:CANCEL` on unschedule. Delivery is quadruple-redundant: `.ics` attachment, Google/Outlook deeplink buttons, a tokenized cookie-less download, and a per-speaker subscription feed. Verified against real inboxes two days before CP3.

## Dependencies
- **Hard (blocks start):**
  - [M34](./M34-comms-outbox-dispatcher.md) — the dispatcher, `buildContext`, and `server/resend.ts` (attachments ride on the Resend call; the invite state write happens inside the dispatcher's per-row pipeline).
  - [M02](./M02-shared-contracts.md) — branded ids, `TemplateVars` for `schedule_assigned`/`schedule_changed`.
  - [M03](./M03-db-schema-migrations.md) — `calendar_invites` (`ics_uid` UNIQUE, `sequence`, `last_method`, `organizer_email` — ★ rev. 3 delta #16, `UNIQUE(contact_id, session_id)`), `sessions.schedule_revision`, `session_speakers`, `published_sessions_v` migrated on sb-dev.
- **Soft (start against stub/fixture):**
  - `issuePortalToken(dbOrTx, {contactId, eventId, purpose:'ics_download', ttl})` ([M06b](./M06b-portal-auth.md)) — code against the signature; until it lands, the `/cal` routes accept a **seed-planted** `portal_tokens` row (insert one by hand in `scripts/seed/comms.ts`) so the route logic is testable. **Swap step:** import from `@/features/auth`; nothing else changes.
  - **[M06b](./M06b-portal-auth.md)'s `verifyPortalToken(raw, {purpose})` is a HARD dependency of steps 6–7** (the two `/cal` routes), not a soft one. It is the non-consuming verifier — it hashes, checks `expires_at > now()` and `consumed_at IS NULL`, and **writes nothing** — which is the only way the `/cal` routes can honour both this module's guardrail ("the `/cal` routes must not mint or hash tokens themselves") and the `ics_download` rule that `consumed_at` stays NULL forever. M06b's internal `consumeToken` sets `consumed_at` and must never be used here.
  - Real scheduled sessions arrive with [M28](./M28-sessions-crud.md) (Sat–Sun AM). Build against [M09](./M09-seed-demo-script.md)'s ~15 seeded sessions (2 named conflict pairs, 3 unscheduled) — they exist Sat AM.
  - `schedule_assigned` outbox rows are enqueued by [M28](./M28-sessions-crud.md)'s `moveSession`/publish path. Until they appear, insert one by hand via `enqueueEmail` in the seed module.

## Provides (interfaces others consume)
```ts
// src/features/comms/ics.ts — pure, no deps, no date libs
export type IcsEvent = {
  uid: string; sequence: number; method: 'REQUEST' | 'CANCEL' | null;   // null = feed (subscription semantics)
  startsAt: Date; endsAt: Date; dtstamp: Date;
  summary: string; description: string; location: string; url: string;
  organizer: { name: string; email: string };
  attendee?: { name: string; email: string };
  cancelled?: boolean;                                                   // → STATUS:CANCELLED
};
export function buildInvite(e: IcsEvent): string;                        // one VEVENT, METHOD from e.method
export function buildFeed(calName: string, events: IcsEvent[]): string;  // VCALENDAR, no METHOD, same UIDs
export function googleCalendarUrl(e: IcsEvent): string;
export function outlookCalendarUrl(e: IcsEvent): string;
export function icsUid(sessionId: string, contactId: string, domain: string): string; // `sess-{id}-spk-{id}@{domain}`
```
```ts
// src/features/comms/server/invites.ts — consumed by M34's dispatcher only
export async function prepareInvite(row: CommLogRow & { sessionId: string; contactId: string }):
  Promise<{ ics: string; filename: 'invite.ics'; contentType: string; uid: string; sequence: number;
            googleUrl: string; outlookUrl: string; downloadUrl: string } | null>;   // null = nothing to send
```
- Routes: `GET /cal/[token]` (per-speaker **feed**, METHOD-less, cookie-less) and `GET /cal/[token]/[sessionId]` (single-session download, `METHOD:PUBLISH`). Consumed by email bodies and by the portal's "subscribe to all your sessions" link ([M21](./M21-portal-shell.md) may link it once this lands — dashed, not blocking).
- Barrel appends: `export { buildInvite, buildFeed, icsUid } from './ics';`

## Step-by-step implementation

1. **Contract-first slice: the pure builder + its golden fixtures.** Write `ics.ts` with the signatures above and `ics.test.ts` asserting against committed `__fixtures__/request.ics`, `cancel.ics`, `feed.ics`. This slice needs **only** [M02](./M02-shared-contracts.md) — start it any time, even before [M34](./M34-comms-outbox-dispatcher.md) finishes.
   - Emission order inside `VCALENDAR`: `BEGIN:VCALENDAR`, `VERSION:2.0`, `PRODID:-//openboard//EN`, `CALSCALE:GREGORIAN`, `METHOD:…` (omitted for feeds), then `VEVENT`(s), `END:VCALENDAR`.
   - `VEVENT` properties: `UID`, `SEQUENCE`, `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `URL`, `STATUS:CONFIRMED|CANCELLED`, `ORGANIZER;CN=<name>:mailto:<addr>`, `ATTENDEE;CN=<name>;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:<addr>`, `LAST-MODIFIED`.
   - **REQUEST/CANCEL require `attendee`, and its `email` must be the message's `To:` recipient** (rev. 3 delta #16). Enforcement is split by what each layer can see: `buildInvite` throws `AppError('VALIDATION', …)` on a REQUEST/CANCEL without an attendee (feeds are the only attendee-less shape) — it cannot check the recipient because the pure builder never sees the message envelope; the equality is asserted in step 4's dispatcher wiring, where both values exist. Gmail and Outlook silently degrade an invite whose ATTENDEE does not match the recipient to a dead `.ics` attachment — no chip, no RSVP.
   - **Time format: UTC basic only** — `YYYYMMDDTHHMMSSZ`, produced from `d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')`. **No `VTIMEZONE`, no `TZID`, ever** (binding resolution #7). Do not import `date-fns`/`date-fns-tz` here — CI restricts them to `time.ts`.
   - Escaping (`escapeText`): `\` → `\\`, `;` → `\;`, `,` → `\,`, newline → `\n`; strip CR. Applies to SUMMARY/DESCRIPTION/LOCATION and to `CN=` values.
   - Line endings **CRLF**; fold at **75 octets** measured on UTF-8 bytes (not code units), continuation lines start with a single space. Write `fold(line: string): string` and test it with a multi-byte emoji straddling the boundary.
   **Done when:** `pnpm vitest run src/features/comms/ics.test.ts` green with: exact-field assertion vs `request.ics`; SEQUENCE 0 → 1 on the same UID; `cancel.ics` has `METHOD:CANCEL` + `STATUS:CANCELLED` + the same UID and a higher SEQUENCE; `feed.ics` has no `METHOD` line and 2 VEVENTs sharing the invites' UIDs; every emitted line ≤75 octets and every line ends `\r\n`; a title containing `;lkj, "x"\n<img onerror=…>` round-trips escaped; a REQUEST without `attendee` throws; `request.ics` asserts the ATTENDEE mailto equals the fixture recipient; the SEQUENCE-bump and `cancel.ics` fixtures carry an ORGANIZER line **byte-identical** to `request.ics` (delta #16).
2. **★ SATURDAY, SCHEDULED — the canned real-inbox render check.** No app code. Hand-write (or generate with step 1's builder from a node one-liner) a `METHOD:REQUEST` invite for a fake session, base64 it, and `curl` it through Resend as an attachment with `content_type: 'text/calendar; charset=utf-8; method=REQUEST'` from the verified team domain to **one real Gmail address and one real Outlook.com address** (team-owned inboxes). If domain verification is not green yet, keep this gate red and retry after DNS clears; resend.dev is not claimed as an arbitrary-recipient fallback.
   ```bash
   curl -sS https://api.resend.com/emails -H "Authorization: Bearer $RESEND_API_KEY" \
     -H 'Content-Type: application/json' -d @canned-invite.json
   ```
   If a team member has an M365/corporate-Exchange mailbox, send it a **separate** canned invite with that address as both `To:` and sole `ATTENDEE` — CC'ing it on the main probe would show it an invite addressed to someone else, which degrades by design (delta #16) and tests nothing. Corporate Outlook parses invites differently from Outlook.com; a pass is free signal, a fail is not a gate.
   **Done when:** screenshots of the Gmail event chip (RSVP buttons visible) and the Outlook invite header are pasted into `DECISIONS.md` with the date. **If a client shows a plain attachment instead of the event chip, check the two usual causes before concluding the path is dead (delta #16): ATTENDEE ≠ the `To:` address, or ORGANIZER not on the sending domain — both are minutes to fix and retest. If either client still fails:** adopt the pre-decided fallback the same hour — the schedule email leads with the Google/Outlook deeplink buttons + download link, attachment demoted to a secondary line. Record the decision; do not re-litigate Monday.
3. **Invite state machine** — `server/invites.ts`. `calendar_invites` is the durable state per (contact, session).
   - UID (PLAN §4, authoritative; supersedes the design docs' `sb-…` spelling): `sess-{sessionId}-spk-{contactId}@{domain}` where `domain` is the host part of `EMAIL_FROM`.
   - Upsert on every prepared send, in one statement:
     ```sql
     INSERT INTO calendar_invites (event_id, contact_id, session_id, ics_uid, sequence, last_method, last_sent_at, organizer_email)
     VALUES ($e,$c,$s,$uid,$rev,$method,now(),$org)
     ON CONFLICT (contact_id, session_id) DO UPDATE
       SET sequence = GREATEST(calendar_invites.sequence, EXCLUDED.sequence)
                    + CASE WHEN EXCLUDED.last_method = 'cancel' AND calendar_invites.sequence >= EXCLUDED.sequence
                           THEN 1 ELSE 0 END,
           last_method = EXCLUDED.last_method, last_sent_at = now()
     RETURNING sequence, ics_uid, organizer_email;
     ```
     `$rev = sessions.schedule_revision`; `$org` = the current `EMAIL_FROM` address. The `GREATEST` makes SEQUENCE monotonic even if revisions arrive out of order; the CASE guarantees a CANCEL always outranks the last REQUEST. **Never** derive SEQUENCE from a counter that can reset. **Note `organizer_email` is absent from the `DO UPDATE` set — it is stamped on first insert and never overwritten; the emitted `ORGANIZER` always uses the RETURNING'd stored value, and if the current `EMAIL_FROM` differs, log loudly and keep the stored one** (the mechanical backstop for delta #16's byte-stability — a mid-hackathon `EMAIL_FROM` change cannot fork existing invites).
   - `prepareInvite(row)` re-reads the session (`starts_at`, `ends_at`, `status`, room name, track name, title, description) and the contact; returns `null` (→ dispatcher marks the row `skipped`) if the session is unscheduled/unpublished for a REQUEST-class key. Method: `schedule_assigned`/`schedule_changed` → `REQUEST`; a row whose session is unscheduled/unpublished **and** whose `calendar_invites` row exists with `last_method='request'` → `CANCEL` with `cancelled: true`.
   - `DESCRIPTION` = session description (plain-text stripped) + blank line + the portal link; `LOCATION` = `room · event.location`; `URL` = `${APP_BASE_URL}/e/${slug}/schedule?session=${sessionId}`; `ORGANIZER` = `{name: event.name, email: EMAIL_FROM address}` (a plausible address on the verified sending domain — Gmail suppresses RSVP otherwise). **The mailto must be byte-identical across every send for a UID** (delta #16): derive it from `EMAIL_FROM` only — never per-event config — and freeze `EMAIL_FROM` once the first invite is out; clients key update-in-place and CANCEL on (UID, ORGANIZER), so a changed organizer forks the calendar entry and voids the CANCEL.
   **Done when:** PGlite test — first send writes `sequence=0, last_method='request'`; a `schedule_revision` bump to 1 then send writes `sequence=1`, same `ics_uid`; a cancel then writes `sequence=2, last_method='cancel'`; and swapping `EMAIL_FROM` between sends still emits the **original** stored `organizer_email` in the ICS (byte-stability survives config change and restart — the value is in the row, not in memory).
4. **Dispatcher wiring.** In [M34](./M34-comms-outbox-dispatcher.md)'s per-row pipeline, for the two schedule keys: call `prepareInvite` → attach `{filename:'invite.ics', content: base64(ics), content_type:'text/calendar; charset=utf-8; method=REQUEST|CANCEL'}` to the Resend payload, store `ics_uid` on the log row, and inject `calendar.google_url` / `calendar.outlook_url` / `calendar.download_url` into the template vars. In `EMAIL_MODE=log`, still build the ICS and store `ics_uid` — the lifecycle is then fully testable without sending. `prepareInvite` sets `attendee` from the same contact row the dispatcher addresses, so the two cannot drift — assert `attendee.email === recipientEmail` (the dispatcher's `To:`) anyway and mark the row `failed` on mismatch, making **no** Resend call; never send a known-degraded invite (delta #16).
   **Done when:** dispatching a seeded `schedule_assigned` row in log mode sets `communication_logs.ics_uid` and a `calendar_invites` row exists with `sequence=0`; **and a dispatcher-level gate test passes both ways — matching `attendee.email`/`recipientEmail` proceeds to send/log, a forced mismatch marks the row `failed` with zero Resend calls** (delta #16; the fixture assertion alone cannot prove this — only a dispatcher test connects ATTENDEE to the actual `To:`).
5. **Deeplink builders.** `googleCalendarUrl`: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=YYYYMMDDTHHMMSSZ/YYYYMMDDTHHMMSSZ&details=…&location=…` (all `encodeURIComponent`). `outlookCalendarUrl`: `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=…&startdt=<ISO>&enddt=<ISO>&location=…&body=…`. These are pure URL construction and are the guaranteed-pass fallback for the brief's "Gmail, Outlook".
   **Done when:** unit test asserts both URLs parse, carry UTC times matching the ICS, and survive a title containing `&`, `#`, and a comma.
6. **Tokenized download route** — `src/app/cal/[token]/[sessionId]/route.ts`. `force-dynamic`. Resolve the token with **`await verifyPortalToken(token, { purpose: 'ics_download' })`** from `@/features/auth` ([M06b](./M06b-portal-auth.md)) → `{contactId, eventId} | null`. **Do not hash or query `portal_tokens` here** — that would contradict this module's own guardrail and duplicate the auth feature's logic; `verifyPortalToken` is non-consuming by construction, so **`consumed_at` stays NULL forever** and calendar clients can fetch repeatedly. Then verify the session belongs to the token's event **and** that the token's contact is on `session_speakers` for it; else 404 (never 403 — do not confirm existence). Respond with `buildInvite({…, method: null})` rendered as `METHOD:PUBLISH`, headers `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="invite.ics"`, `Cache-Control: private, max-age=300`.
   **Done when:** `curl -i "$APP_BASE_URL/cal/<seeded-token>/<sessionId>"` → 200 + `text/calendar`, and a tampered token → 404.
7. **Per-speaker feed route** — `src/app/cal/[token]/route.ts`. Same `verifyPortalToken(token, {purpose:'ics_download'})` call, no session id. Emits `buildFeed(`${event.name} — ${first} ${last}`, …)` over **all published, scheduled sessions for that contact** (read `published_sessions_v` joined to `session_speakers`), METHOD-less, same UIDs as the invites so clients dedupe, plus `X-WR-CALNAME`. Headers: `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: inline`, `Cache-Control: private, max-age=300`.
   **Done when:** the URL subscribes successfully in Apple Calendar (File → New Calendar Subscription) and shows the seeded speaker's sessions; a speaker with zero published sessions returns a valid empty `VCALENDAR` (not a 500).
8. **★ SUNDAY, SCHEDULED — the full seeded lifecycle to real inboxes.** With `EMAIL_MODE=send` + `EMAIL_ALLOWLIST` set to the two team inboxes, drive the whole chain from seeded data through the dispatcher: (a) publish + schedule a seeded session with a team-owned speaker → `schedule_assigned` REQUEST arrives, renders as an invite; (b) move the session (bumps `schedule_revision`) → `schedule_changed` REQUEST arrives and **updates the existing entry in place** (no duplicate) in both Gmail and Outlook; (c) unschedule → `METHOD:CANCEL` removes it. This is a full day before CP3 by design.
   **Done when:** three screenshots per client in `DECISIONS.md` and `psql -c "select sequence, last_method from calendar_invites where ics_uid='…'"` shows `0/request → 1/request → 2/cancel`.
9. **Mon CP3 re-check (thin).** Repeat only leg (a) from a **real scheduling action** in [M30](./M30-day-grid-dnd.md)'s Day grid to prove the domain→outbox→ICS path, not the ICS itself.
   **Done when:** the invite lands from a drag-and-drop-initiated publish.

## Acceptance criteria
**Catalog AC (verbatim):** unit tests assert exact fields/SEQUENCE/CANCEL/folding; Sat canned invite renders natively in Gmail AND Outlook (screenshot in DECISIONS.md); reschedule in Gmail updates-in-place (no duplicate); unschedule removes via CANCEL; feed URL subscribes in Apple Calendar.

Verification:
- `pnpm vitest run src/features/comms/ics.test.ts` (golden fixtures, folding, escaping, SEQUENCE, attendee-required-on-REQUEST/CANCEL, ORGANIZER byte-stability across the fixture set).
- `curl -sS "$APP_BASE_URL/cal/<token>/<sessionId>" | head -20` — CRLF-terminated, `METHOD:PUBLISH`, `DTSTART:…Z`.
- `curl -sS "$APP_BASE_URL/cal/<token>" | grep -c BEGIN:VEVENT` — equals the speaker's published session count.
- `psql -c "select ics_uid, sequence, last_method, organizer_email from calendar_invites order by last_sent_at desc limit 5"`.
- Dispatcher gate test (step 4): forced attendee/recipient mismatch → row `failed`, zero Resend calls; matching case → sent/logged.
- Manual: the DECISIONS.md screenshot set from steps 2 and 8 (calendar clients are the one thing tests cannot prove).

## Guardrails
- **UTC `Z` only — no VTIMEZONE, ever** (resolution #7). Any PR adding `TZID` or a `VTIMEZONE` block is reverted. The human-readable time lives in the *email body*, formatted in event tz with its label via `time.ts`.
- **Stable UID + monotonic SEQUENCE is the whole ballgame.** A new UID per send = duplicate calendar entries in every judge's calendar — the single most visible possible bug (risk #6, analysis trap #4). Never regenerate a UID; never write `sequence = 0` on an existing row.
- **`ORGANIZER` must be a real mailbox on the verified Resend domain** or Gmail suppresses the RSVP buttons — **and it is immutable per UID** (delta #16): stamped into `calendar_invites.organizer_email` at first send and reused verbatim thereafter — the mechanical backstop that makes byte-stability survive an `EMAIL_FROM` change or a restart. `EMAIL_FROM` additionally policy-freezes the moment the first invite is sent: an orphaned organizer means reschedules duplicate instead of updating and CANCELs are ignored.
- **ATTENDEE = the `To:` recipient, always** (delta #16). A REQUEST without an ATTENDEE, or with someone else's address, renders as a dead attachment in both clients — the failure looks identical to risk #6's rendering problem but is a data bug, and it is the first diagnostic to check when a chip does not appear.
- **Tokens go through `issuePortalToken` to mint and `verifyPortalToken` to check** (resolution #12) — the `/cal` routes must not mint **or hash** tokens themselves; `purpose='ics_download'` is single-audience (an ICS token grants nothing but ICS). If `verifyPortalToken` is not exported yet, that is a one-line ask to the architect, **not** a licence to hash locally.
- **`consumed_at` must stay NULL** for `ics_download` tokens; consuming one on first fetch breaks calendar-client polling.
- **CRLF + 75-octet folding measured in bytes.** Outlook is the strict one; a 76-octet line or an LF-only terminator can silently degrade the invite to a plain attachment.
- Edge cases: session with NULL room → `LOCATION` falls back to the event location (never the literal `null`); a co-speaker removed from a session → their invite gets `CANCEL`, the others' do not; an unpublished draft session must never produce an invite (published-only, same rule as [M32](./M32-public-schedule-gallery.md)); a session whose times are NULL never reaches `buildInvite` (guard in `prepareInvite`); DST — the stored instants are UTC so nothing to do, but the *email body's* local time must come from `formatInZone` with the zone label.
- **No ICS library, no `ical-generator`, no `moment-timezone`** (banned, bundle size + Workers compat).

## If blocked
- Blocked on [M34](./M34-comms-outbox-dispatcher.md): step 1 (the pure builder + golden fixtures + folding/escaping tests) and step 5 (deeplinks) are fully independent — they need only [M02](./M02-shared-contracts.md). Do those first; they are also the highest-value tests in the module.
- Blocked on [M28](./M28-sessions-crud.md) (no real scheduled sessions): use [M09](./M09-seed-demo-script.md)'s seeded sessions and a hand-inserted `schedule_assigned` outbox row — the whole lifecycle test (step 8) runs off seed data by design.
- Blocked on `issuePortalToken`/`verifyPortalToken`: plant a `portal_tokens` row in the seed and build the routes behind a local `verifyPortalToken`-shaped shim in **one** file, marked `// TODO(M06b)`, so the swap is a single import. Never inline the hash into a route handler.
- Ahead of schedule: start [M36](./M36-reminder-scan.md) step 1 (the two scan statements), or add the Apple-Calendar subscription screenshot to `DECISIONS.md`, or extend `ics.test.ts` with an all-day/very-long-description case.
