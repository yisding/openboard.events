# Openboard public API (`/api/v1`)

Every JSON response is one of three envelope shapes (the error envelope is zod-validated on the
way out; success DTOs are written out field by field):

```json
{ "data": ... }
{ "data": [...], "meta": { "...": "..." } }
{ "error": { "code": "NOT_FOUND", "message": "Event not found" } }
```

`$APP_BASE_URL` is whichever origin you are calling — `https://openboard.events` in production,
or the deployed preview `https://sb-web-preview.yi-ding.workers.dev`. `$SLUG` is an event slug
(the seeded sample event is `ai-engineer-sandbox-event`). Set both before pasting any command
below:

```bash
export APP_BASE_URL='https://openboard.events'
# export APP_BASE_URL='https://sb-web-preview.yi-ding.workers.dev'
export SLUG='ai-engineer-sandbox-event'
```

Every command below is also collected in [`api-examples.sh`](./api-examples.sh), which runs them
against a live deployment and asserts each status code — all 200s plus the deliberate 401s, the
deliberate 404, the 204 preflight and the deliberate 400 — along with the response shapes and
cache/CORS headers, so the examples cannot rot into documentation that no longer matches the API:

```bash
export KEY='ob_live_…'          # Settings → API keys; omit and set SKIP_KEYED=1 for the unkeyed half
bash docs/api-examples.sh
```

## Unkeyed — published data

Thin wrappers over the exact contracts the public schedule/speaker pages use — the same
`published_sessions_v` / `published_speakers_v` read path, so the API and the public page can never
disagree about what is published. Zero unconfirmed speakers, zero draft/unscheduled sessions.

| Endpoint | Backing | Cache |
|---|---|---|
| `GET /api/v1/events/{slug}` | `resolvePublicEvent` + `publicEventDto` (`api/v1/_lib.ts`) | `public, s-maxage=60, stale-while-revalidate=300` |
| `GET /api/v1/events/{slug}/schedule` | `published_sessions_v` | same |
| `GET /api/v1/events/{slug}/speakers` | `published_speakers_v` | same |
| `GET /api/v1/events/{slug}/schedule/ics?session=` | `buildPublicScheduleIcs` (`published_sessions_v`) | `no-store` — a calendar file, not JSON |

`/schedule/ics` is the only v1 route that does not answer the JSON envelope: it returns a
`text/calendar` attachment. `?session=<id>` may repeat or be comma-separated; omitted means the
whole published schedule.

```bash
curl -s "$APP_BASE_URL/api/v1/events/$SLUG" | jq .
curl -s "$APP_BASE_URL/api/v1/events/$SLUG/schedule" | jq '.data | length, .meta'
curl -s "$APP_BASE_URL/api/v1/events/$SLUG/speakers" | jq '.data | length'

# Cache + CORS headers, on every successful unkeyed response:
curl -sI "$APP_BASE_URL/api/v1/events/$SLUG" | grep -i 'cache-control\|access-control-allow-origin'

# Unknown slug → 404, never a 200 with empty data:
curl -s -o /dev/null -w '%{http_code}\n' "$APP_BASE_URL/api/v1/events/does-not-exist"

# Preflight:
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS "$APP_BASE_URL/api/v1/events/$SLUG"
```

## Keyed — an event's own data

Authenticated by an event-scoped bearer key, issued from **Settings → API keys** inside the admin
(`/events/{eventId}/settings/api-keys`). A key is hashed (`sha256`) before it is stored in `api_keys`;
the plaintext is shown exactly once, at creation, and is unrecoverable afterward — losing it means
revoking it and creating a new one.

```bash
curl -s -H "Authorization: Bearer $KEY" "$APP_BASE_URL/api/v1/events/$SLUG/stats" | jq .
```

Every keyed response is `Cache-Control: private, no-store` (never edge-cached — a cached `/stats`
would be both wrong and a leak) with the same permissive CORS as the unkeyed routes.

An unknown/missing/wrong-event key answers **401 before 404** — a key-less caller learns nothing
about whether a slug exists:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer nope' "$APP_BASE_URL/api/v1/events/$SLUG/stats"
# 401
curl -s -H 'Authorization: Bearer nope' "$APP_BASE_URL/api/v1/events/$SLUG/stats" | jq .
# { "error": { "code": "UNAUTHORIZED", "message": "Invalid API key" } }
```

| Endpoint | Backing |
|---|---|
| `GET /api/v1/events/{slug}/submissions?status=&limit=&cursor=` | `submissions` (excludes drafts unconditionally) |
| `GET /api/v1/events/{slug}/speakers/outstanding-tasks` | `speaker_outstanding_v` — the same view the dashboard reads |
| `GET /api/v1/events/{slug}/stats` | `getOverview` (the dashboard's own aggregate query) |
| `GET /api/v1/events/{slug}/comms-log?limit=` | `listLog` — never a rendered body or subject line; `limit` defaults to 50 and is clamped to 200 |

### `/submissions`

```bash
curl -s -H "Authorization: Bearer $KEY" "$APP_BASE_URL/api/v1/events/$SLUG/submissions" | jq '.data[0], .meta'
```

Each row: `{ code, title, status, kind, track, tags, submitterEmail, speakers, submittedAt, notifiedAt, rating }`.

- **Drafts never appear, even with no `status` filter at all** — the draft-leak guard cannot be
  turned off by omitting the filter:

  ```bash
  curl -s -H "Authorization: Bearer $KEY" "$APP_BASE_URL/api/v1/events/$SLUG/submissions" \
    | jq '[.data[] | select(.status=="draft")] | length'
  # 0
  ```

- `?status=` narrows to one non-draft status (`pending`, `accept_queue`, `decline_queue`, `accepted`,
  `declined`, `withdrawn`). `?status=draft` is rejected with `400 VALIDATION` and lists the allowed
  values in `error.message` — there is no way to ask this endpoint for drafts.
- `?limit=` defaults to 50 and is **clamped** to 200, never rejected, for an over-large value.
- `?cursor=` is the numeric submission code to page past — always take it from `.meta.nextCursor`
  rather than from a row's `code` field, which is the display form (`SESS-42`) and is rejected as
  a cursor. `.meta.nextCursor` is `null` once there is nothing more to page through:

  ```bash
  PAGE1=$(curl -s -H "Authorization: Bearer $KEY" "$APP_BASE_URL/api/v1/events/$SLUG/submissions?limit=1")
  CURSOR=$(echo "$PAGE1" | jq -r '.meta.nextCursor')
  curl -s -H "Authorization: Bearer $KEY" "$APP_BASE_URL/api/v1/events/$SLUG/submissions?limit=1&cursor=$CURSOR" | jq .
  ```

### `/speakers/outstanding-tasks`

```bash
curl -s -H "Authorization: Bearer $KEY" "$APP_BASE_URL/api/v1/events/$SLUG/speakers/outstanding-tasks" | jq .
```

`[{ contactId, name, email, openCount, overdueCount }]` — the same `speaker_outstanding_v` numbers the
admin dashboard's Speaker Tracking panel and the speaker portal's task badges show, so this can never
quietly disagree with what an organizer sees. Speakers with no open tasks are omitted entirely, and
rows are ordered most-outstanding first.

### `/stats`

```bash
curl -s -H "Authorization: Bearer $KEY" "$APP_BASE_URL/api/v1/events/$SLUG/stats" | jq .
```

`{ kpis, statusCounts, speakerTracking }` — the dashboard's own aggregate (`getOverview`), minus the
two UI-only fields (`attention` hrefs point at admin routes a keyed caller cannot reach;
`recentSubmissions` duplicates `/submissions`). Zero second implementation of any count.

### `/comms-log`

```bash
curl -s -H "Authorization: Bearer $KEY" "$APP_BASE_URL/api/v1/events/$SLUG/comms-log?limit=20" | jq .
```

`[{ recipient: { name, email }, templateKey, status, providerMessageId, createdAt, sentAt }]` — never a
rendered subject or body. A rendered subject or body can itself carry a live magic link (the
`portal_login` template), so neither is ever serialized here, and no internal id (`submissionId`,
`sessionId`, `taskId`, `icsUid`) is either.

## Error codes

| Code | HTTP | When |
|---|---|---|
| `VALIDATION` | 400 | Bad query param — e.g. `status=draft`, a non-numeric `cursor` |
| `UNAUTHORIZED` | 401 | Missing/invalid/wrong-event bearer key on a keyed route |
| `NOT_FOUND` | 404 | Unknown slug (unkeyed routes only — keyed routes 401 first) |
| `RATE_LIMITED` | 429 | More than 300 requests in 5 minutes on one route bucket (per API key, or per IP on the unkeyed routes) |
| `INTERNAL` | 500 | Unexpected server error |

## CORS and caching

- `Access-Control-Allow-Origin: *` on every `/api/v1/*` response, including errors, plus an `OPTIONS`
  handler on every route returning `204`. This is deliberate: `/api/v1` is the one surface in this app
  meant to be called from another origin (an embed, an external script). `/api/internal/*` (the admin's
  own routes) never gets this CORS treatment. The framing/CSP headers are orthogonal and global:
  every path except `/embed/*` — `/api/v1` included — keeps `X-Frame-Options: DENY`
  (`src/shared/lib/security-headers.ts`).
- Unkeyed routes: successful responses are `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
  — cached at Cloudflare's edge, safe because the data is already public. Error responses
  (404/400/429/500) are `private, no-store` on every route, keyed or not, so a rejection never lands
  in a shared cache.
- Keyed routes: `Cache-Control: private, no-store` — never enters a shared cache, because the data is
  scoped to whoever holds the key.

## Rate limiting

Authorization and event scoping (the 401-before-404 rule, the per-event key lookup) are **application
guarantees**, enforced by `apiKeyAuth()` on every keyed route. Every `/api/v1` route is additionally
rate-limited in the application: a fixed 300-request / 5-minute window per route bucket
(`v1RateLimit` / `checkV1RateLimit` in `src/app/api/v1/_lib.ts`), keyed on the API key id for keyed
routes and on the caller's IP for the unkeyed ones. Exceeding it answers `429 RATE_LIMITED`. Each
route has its own bucket, so a burst on one endpoint does not consume another's budget.

## API keys — issuing and revoking

From **Settings → API keys** on any event (`/events/{eventId}/settings/api-keys`, organizer role):

1. **Create key** — label it by what will use it. The plaintext (`ob_live_…`) is shown once, with a
   copy button and an explicit "you will not see this again" warning. Only its `sha256` hash is stored.
2. **Revoke** — immediate; the next request with that key gets `401 UNAUTHORIZED`.

There is no global environment API key. That shortcut could not enforce event scope — a leaked key
would read every event, not one — and is unsafe even for a demo.
