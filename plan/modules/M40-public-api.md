# M40 — Public API + keys

| | |
|---|---|
| **Status** | IN PROGRESS — PR #5 contains fixture-backed API scaffolding that is **REVIEW-BLOCKED** on private caching, global-key/event scoping, and public DTO leakage; bonus completion is paused behind R3. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-F (Comms + Dashboard + Airtable + API) — routes `app/api/v1/**`, plus the two declared files inside `features/dashboard` for stats/key reuse. |
| **Scheduled** | **May start Mon PM** ([M32](./M32-public-schedule-gallery.md) landed Sunday, [M38](./M38-dashboard.md) lands Monday); **finishes Tuesday** (CP4). |
| **Size** | M (≈half-day) |
| **Paths owned** | `src/app/api/v1/**` (all route files), `src/app/(admin)/events/[eventId]/settings/api-keys/page.tsx`, `src/features/dashboard/server/api-keys.ts`, `src/features/dashboard/components/ApiKeysPanel.tsx` (**declared cross-module grant inside [M38](./M38-dashboard.md)'s folder — M38 owns everything else there**), `docs/api.md` |

## Objective
`/api/v1` exposes three **unkeyed published-data** endpoints (event, schedule, speakers) that are thin wrappers over the exact contracts the public pages use — zero drift, zero new leak paths — plus four **keyed** endpoints (submissions, outstanding tasks, stats, comms log) authenticated by hashed bearer keys managed from a small Settings page. Every response is a zod-serialized `{data}` / `{error:{code,message}}` envelope, CORS-open, and cached at the edge for 60 s on the public routes. `docs/api.md` contains paste-and-run curl examples.

## Dependencies
- **Hard (blocks start):**
  - [M32](./M32-public-schedule-gallery.md) — `getPublishedSchedule(eventSlug)` and `getPublishedSpeakers(eventSlug)` exported from the `embeds` barrel (the **only** draft-leak-proof read path; landed Sunday).
  - [M38](./M38-dashboard.md) — `getOverview(eventId)` + the `DashboardOverview` type (backs `/stats`).
  - [M04](./M04-shared-libs.md) — `defineHandler`, `errors.ts`, `getEnv()`; [M02](./M02-shared-contracts.md) — the API envelope schemas in `contracts/api.ts`.
  - [M03](./M03-db-schema-migrations.md) — `api_keys` (hashed) table migrated; `events.slug` unique.
- **Soft (start against stub/fixture):**
  - [M38](./M38-dashboard.md)'s `FIXTURE_OVERVIEW` — build `/stats` against it Monday PM and swap to `getOverview` when the real query lands (one line).
  - [M17](./M17-abstracts-table.md)'s `listSubmissions(eventId, filters)` for `/submissions`; if its shape is still moving, map from it inside `api/v1` rather than asking for a change — the public DTO is this module's own.
  - [M34](./M34-comms-outbox-dispatcher.md)'s `listLog` for `/comms-log` (available from Saturday).
  - [M06a](./M06a-admin-auth.md)'s `requireAdmin` for the keys page.

## Provides (interfaces others consume)
| Endpoint | Auth | Backing contract | Cache |
|---|---|---|---|
| `GET /api/v1/events/[slug]` | none | `events.getEventBySlug` ([M11](./M11-events-feature.md)) | `public, s-maxage=60, stale-while-revalidate=300` |
| `GET /api/v1/events/[slug]/schedule` | none | `getPublishedSchedule` ([M32](./M32-public-schedule-gallery.md)) | same |
| `GET /api/v1/events/[slug]/speakers` | none | `getPublishedSpeakers` ([M32](./M32-public-schedule-gallery.md)) | same |
| `GET /api/v1/events/[slug]/submissions?status=` | key | `listSubmissions` ([M17](./M17-abstracts-table.md)) | `private, no-store` |
| `GET /api/v1/events/[slug]/speakers/outstanding-tasks` | key | `speaker_outstanding_v` via [M38](./M38-dashboard.md) | `private, no-store` |
| `GET /api/v1/events/[slug]/stats` | key | `getOverview` ([M38](./M38-dashboard.md)) | `private, no-store` |
| `GET /api/v1/events/[slug]/comms-log` | key | `listLog` ([M34](./M34-comms-outbox-dispatcher.md)) | `private, no-store` |

```ts
// src/features/dashboard/server/api-keys.ts  (owned by M40) — key CRUD ONLY.
// Authentication is NOT here: keyed routes use defineHandler({ auth: apiKeyAuth(), … }) with the guard
// factory M06a exports from @/features/auth. Two hashed-bearer implementations means two places to get
// key scoping wrong, and it bypasses defineHandler's guard mechanism entirely — do not add requireApiKey.
export async function createApiKey(eventId: EventId, label: string): Promise<{ id: string; plaintext: string }>; // shown once
export async function listApiKeys(eventId: EventId): Promise<{ id: string; label: string; lastFour: string; createdAt: string; lastUsedAt: string | null }[]>;
export async function revokeApiKey(eventId: EventId, id: string): Promise<void>;
```
- `docs/api.md` — the public documentation; [M10](./M10-e2e-release.md)'s README links it. Consumed by judges.

## Step-by-step implementation

1. **Contract-first slice.** Create `src/app/api/v1/_lib.ts` with the envelope helpers and the CORS/cache wrapper, and stub all seven route files returning `{data: null}` with the right status/headers. This makes the surface curl-able (and documentable) before any backing query is wired.
   ```ts
   export const ok  = <T>(data: T, cache: 'public'|'private') => Response.json({ data }, { headers: headersFor(cache) });
   export const err = (code: ApiErrorCode, message: string, status: number) =>
     Response.json({ error: { code, message } }, { status, headers: headersFor('private') });
   // headersFor('public')  → 'Cache-Control: public, s-maxage=60, stale-while-revalidate=300' + CORS
   // headersFor('private') → 'Cache-Control: private, no-store' + CORS
   // CORS on every /api/v1 response: Access-Control-Allow-Origin: *, Allow-Methods: GET,OPTIONS,
   //   Allow-Headers: authorization,content-type; plus an OPTIONS handler per route returning 204.
   ```
   **Done when:** `curl -i "$APP_BASE_URL/api/v1/events/$SLUG"` returns 200 with both the CORS and Cache-Control headers, and `curl -X OPTIONS` returns 204.
2. **Slug resolution + the 404 rule.** One shared `resolveEvent(slug)` in `_lib.ts`: unknown slug → `err('NOT_FOUND', 'Event not found', 404)`. Never leak whether an event exists but is unpublished — there is no such state (events are public by slug), but keyed endpoints must 401 **before** they 404 so a key-less caller cannot enumerate slugs.
   **Done when:** `curl …/api/v1/events/does-not-exist` → 404 envelope; `curl …/api/v1/events/does-not-exist/stats` (no key) → **401**, not 404.
3. **The three unkeyed endpoints.** Each is a ≤15-line wrapper: resolve slug → call the [M32](./M32-public-schedule-gallery.md) contract → zod-serialize through the public DTO → `ok(data, 'public')`.
   - `/events/[slug]`: `{id, name, slug, timezone, startsAt, endsAt, location, websiteUrl}` — **never** internal fields (`submission_seq`, `row_version`, caps).
   - `/events/[slug]/schedule`: `getPublishedSchedule` returns the **flat** `PublishedScheduleDTO` (`{event, days: string[], sessions: PublishedSessionDTO[]}`, [M02](./M02-shared-contracts.md) `contracts/session.ts`); this route re-groups that flat list by the precomputed `dayKey` into `[{day: '2026-10-12', sessions: [{id, title, startsAt, endsAt, room, track, trackColor, format, speakers:[{name, headshotUrl}]}]}]`, plus `meta.timezone`. **That grouping is the API's own output DTO, not a second read path** — the data still comes only from `published_sessions_v` via M32's one contract, and no day math is redone (the `dayKey` is already event-tz correct).
   - `/events/[slug]/speakers`: `[{id, name, jobTitle, company, bioHtml (sanitized), headshotUrl, links, sessions:[{id,title,startsAt}]}]`.
   **Done when:** `curl …/schedule | jq '.data[0].sessions | length'` matches the seeded published count, and `jq '[.data[].sessions[] | select(.title | test("draft"))] | length'` is `0`.
4. **API keys — CRUD here, authentication in `features/auth`.** `features/dashboard/server/api-keys.ts`:
   - Generate `ob_live_` + 32 random bytes base64url (Web Crypto). Store **only** `sha256(plaintext)` in `api_keys` with `event_id`, `label`, `last_four`, `created_at`, `last_used_at`. Return the plaintext **once**, from `createApiKey`, and never again.
   - **Do not write a `requireApiKey` here.** `apiKeyAuth()` is [M06a](./M06a-admin-auth.md)'s guard factory, exported from `@/features/auth` and listed in [M02](./M02-shared-contracts.md) §11's auth barrel alongside `adminAuth`/`portalAuth`/`cronAuth`: it parses `Authorization: Bearer`, sha256s, looks up `api_keys` **scoped to the route's `eventId`**, updates `last_used_at` fire-and-forget, and throws `UNAUTHORIZED` otherwise. Using it keeps every keyed route on the one `defineHandler` guard mechanism instead of a second hashed-bearer implementation — two of those means two places to get key scoping wrong.
   **Done when:** a PGlite/`sb-dev` test asserts a key issued for event A returns 401 on event B's endpoints (cross-event scoping), and that the plaintext is not recoverable from the DB.
5. **The four keyed endpoints.** Each: `defineHandler({ auth: apiKeyAuth(), … })` → backing contract → public DTO.
   - `/submissions?status=`: `status` is validated against the contracts enum; **`draft` is rejected with 400 and drafts are excluded unconditionally** even when no status filter is given (draft-leak guard, independent of the caller). Fields: `{code, title, status, kind, track, tags, submitterEmail, speakers, submittedAt, notifiedAt, rating}`. Paginated `?limit=&cursor=` with `meta.nextCursor`.
   - `/speakers/outstanding-tasks`: `[{contactId, name, email, openCount, overdueCount}]` from `speaker_outstanding_v` — the same view the dashboard and portal use, so the numbers provably agree.
   - `/stats`: the `DashboardOverview` from [M38](./M38-dashboard.md) minus the UI-only fields (`attention` hrefs, `recentSubmissions`), i.e. `{kpis, statusCounts, speakerTracking}`. **Zero second implementation of the counting rule.**
   - `/comms-log`: `listLog(eventId, {limit})` → `{recipient, templateKey, status, providerMessageId, createdAt, sentAt}` — **never** `body_rendered_html` or `subject_rendered` (they contain live magic links). `listLog` returns `CommLogRow`, which does not carry the body at all; `CommLogDetail` is [M37](./M37-comms-admin-ui.md)-only.
   **Done when:** all four return 200 with a valid key, 401 with none/bad, and `jq` on `/submissions` shows no `draft` rows even with `?status=` omitted.
6. **API-keys mini-page.** `settings/api-keys/page.tsx` (its own route file — no contention with [M11](./M11-events-feature.md)'s settings hub) rendering `<ApiKeysPanel>`: list (label, `…last4`, created, last used), **Create key** dialog (label → shows the plaintext once with a copy button and a "you will not see this again" warning), **Revoke** with `<ConfirmDialog>`. All through `/api/internal/…` handlers built with `defineHandler` + `requireAdmin`.
   **Done when:** creating a key and pasting it into the `/stats` curl works on the deployed preview; revoking it makes the same curl 401.
7. **`docs/api.md`.** One table of endpoints + a paste-and-run curl block per endpoint against the **deployed** URL and the seeded slug, the envelope shapes, the error codes, the CORS/cache policy, and an honest rate-limiting note: authorization and event scoping are application guarantees; any custom-domain WAF rule from [M01](./M01-scaffold-ci-deploy.md) is optional defense-in-depth and does not apply to workers.dev.
   **Done when:** every command in the doc is copy-pasted and run once against production, and each returns 200 (or 401 for the deliberate bad-key example).
8. **CP4 verification pass.** Run the full curl set against production; confirm cache headers with `curl -sI` on the three public endpoints; confirm an embed-origin `fetch()` from a scratch HTML page on another origin succeeds (CORS proven, not assumed).
   **Done when:** the transcript is in the CP4 notes.

## Acceptance criteria
**Catalog AC (verbatim):** curl each endpoint against seed data; drafts absent from public endpoints; bad key → 401 envelope; docs example commands paste-and-run.

Verification:
- `bash docs/api-examples.sh` (the curl block extracted from `docs/api.md`) — all 200s / the one intentional 401.
- `curl -s "$APP_BASE_URL/api/v1/events/$SLUG/schedule" | jq '[.data[].sessions[]] | length'` equals `psql -c "select count(*) from published_sessions_v where event_id=…"`.
- `curl -s -H "Authorization: Bearer $KEY" "$APP_BASE_URL/api/v1/events/$SLUG/submissions" | jq '[.data[] | select(.status=="draft")] | length'` → `0`.
- `curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer nope' …/stats` → `401`; body matches `{"error":{"code":"UNAUTHORIZED",…}}`.
- `curl -sI …/api/v1/events/$SLUG | grep -i 'cache-control\|access-control-allow-origin'` → both present.
- Playwright: `public-embeds.spec` ([M10](./M10-e2e-release.md)) asserts the `/api/v1/events/{slug}/schedule` response is published-only.

## Guardrails
- **The three public endpoints are thin wrappers over [M32](./M32-public-schedule-gallery.md)'s contracts** — that is the entire draft-leak defence (`published_sessions_v` / `published_speakers_v`, which also enforce resolution #15's confirmed-only filter). Writing a new query here, "just for the API", is a review-blocker.
- **Keyed responses never carry secrets:** no rendered email bodies, no magic links, no tokens, no `password_hash`, no `idempotency_key`.
- **Keys are hashed, event-scoped, and shown once.** Plaintext must never be logged, stored, or returned by `listApiKeys`. **One implementation of hashed-bearer auth in the repo**: `apiKeyAuth()` in `features/auth`. This module owns key *lifecycle* (create/list/revoke), never key *verification*.
- **401 before 404** on keyed routes (no slug enumeration).
- **Envelopes are zod-serialized** through `contracts/api.ts` (R2 boundary #10) — the schema is what guarantees the API cannot leak an internal field someone adds to a DTO later.
- **CORS `*` on `/api/v1/*` only.** Never on `/api/internal/*`. Admin/portal routes keep `X-Frame-Options: DENY` and no CORS.
- **`s-maxage=60, stale-while-revalidate=300` on public reads only**; keyed reads are `private, no-store`. A cached `/stats` would be both wrong and a leak.
- **No `export const runtime = 'edge'`** (repo-wide grep). Route handlers are `force-dynamic` except where the cache header does the work.
- Edge cases: event with zero published sessions → `{"data":[]}` with 200 (never 404); a speaker with no headshot → `headshotUrl: null` (the `<Dash>` equivalent for JSON); `?status=` with an unknown value → 400 with the allowed list in the message; a very large `limit` → clamped to 200; slug case/trailing slash normalized before lookup.
- **Cut-line #11:** if Tuesday overruns, keep the three unkeyed endpoints + `docs/api.md` (the bonus is still claimed honestly) and drop the keyed set with a one-line note in the README.

## If blocked
- Blocked on [M38](./M38-dashboard.md): build `/stats` against `FIXTURE_OVERVIEW` and everything else for real — the swap is one import.
- Blocked on [M17](./M17-abstracts-table.md)'s list shape: query `submissions` + `submission_ratings_v` directly inside `api/v1` for the public DTO (this is the one place a direct read is acceptable, because the DTO is this module's contract) and swap to `listSubmissions` if it stabilises.
- Blocked on `api_keys` (table missing): ship the three unkeyed endpoints + docs first — they are the bulk of the judged bonus value — and escalate the table to the architect.
- Ahead of schedule: help finish [M39](./M39-airtable-export.md) or [M37](./M37-comms-admin-ui.md) (same Tuesday lane), extend `docs/api.md` with a JS `fetch` example for the embed audience, or add the API section to `docs/demo-script.md`.
