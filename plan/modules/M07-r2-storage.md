# M07 — R2 Storage

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED** (#15, #17): policy table, staging→published keys, the four routes, orphan sweep, and CI grep #11. The seed now uploads real headshot objects (#65/#76), so the browser probe is unblocked. The `/f/{id}` header contract passed on the deployed preview at the rev. 9 redeploy (post-deploy smoke: 200, image content-type, immutable cache, nosniff, from a real seeded R2 object). Remaining before `DONE`: a **browser** presign/PUT/CORS round-trip on the preview, production S3 credentials, and an R2 lifecycle rule on the `staging/` prefix. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-D agent (catalog note: "owner: WS-D — its biggest consumer; moved from WS-A"). This agent also builds M05b (rich UI primitives, filed under WS-A's module set) the same day — both are declared temporary cross-folder grants outside this agent's normal `features/portal` lane (PLAN.md §6). |
| **Scheduled** | **Sat AM** — starts the hour M03's `file_assets` table lands on sb-dev (before CP1, **not** at it); presign/finalize wired Sat PM. Does **not** gate CP1. Steps 1–3 (typed signatures, kind-policy table, key scheme + filename sanitization) are unit-testable against a mocked binding and can be pulled forward to **Fri evening**. Runs in parallel with M05b, whose `<FileUpload>` internals are this module's only real consumer. |
| **Size** | M |
| **Paths owned** | `src/shared/server/r2.ts`; `src/app/api/uploads/presign/route.ts`; `src/app/api/uploads/finalize/route.ts`; `src/app/api/uploads/[fileId]/download-url/route.ts`; `src/app/f/[fileId]/route.ts` |

## Objective

Every uploaded file in the product — event logos/backgrounds, speaker headshots, slide decks, file-request attachments — goes through one module. When done: a browser can request a presigned PUT, upload directly to R2, finalize the row, and immediately view the file back through `/f/{fileId}` with correct caching/content-type headers on the deployed preview; private files 403 without authorization. This unblocks M05b's `<FileUpload>` component and every feature that needs an image or document.

## Dependencies

- **Hard (blocks start):** [./M03-db-schema-migrations.md](./M03-db-schema-migrations.md)'s `file_assets` table migrated on sb-dev (columns: `id, event_id, kind, r2_key, filename, mime, size_bytes, uploaded_by_user_id, uploaded_by_contact_id, created_at`, `UNIQUE(id,event_id)`, `UNIQUE(r2_key)`). [./M04-shared-libs.md](./M04-shared-libs.md)'s `getEnv()` accessor (R2 credentials/bucket name/`APP_BASE_URL`) and `errors.ts` (`AppError` codes) — build against typed stubs for these two if M04 is mid-flight; swap the real imports the hour they land.
- **Soft (start against stub/fixture):** the R2 bucket + CORS + wrangler `FILES` binding are provisioned by [./M01-scaffold-ci-deploy.md](./M01-scaffold-ci-deploy.md) Fri night (existential spike S1, "OpenNext deploy + R2 ISR cache") and the aws4fetch presign path is a Sat-AM deferred spike (§7). If either slips, write `r2.ts` and its unit tests against a mocked binding (in-memory `Map<string, Buffer>` fake implementing the same interface) so the presign/finalize/serve *logic* is correct and swap the real Cloudflare binding in the same hour M01's bucket lands — no signature changes.

## Provides (interfaces others consume)

```ts
// src/shared/server/r2.ts
export type FileKind = 'logo'|'background'|'headshot'|'attachment'|'slide'|'upload'; // = file_kind enum

export interface CreateUploadInput {
  eventId: EventId;
  kind: FileKind;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedByUserId?: string;      // admin uploader
  uploadedByContactId?: string;   // portal uploader
  policyOverride?: { extensions: string[]; maxSizeMb: number }; // kind='upload' only, from the owning file_request row
}
export interface CreateUploadResult {
  fileId: string;
  uploadUrl: string;              // presigned PUT, 15-min expiry
  requiredHeaders: Record<string, string>; // must be sent verbatim on the PUT (Content-Type)
}
export async function createUpload(input: CreateUploadInput): Promise<CreateUploadResult>;   // PROPOSED

export async function finalizeUpload(fileId: string):
  Promise<{ status: 'ready' } | { status: 'rejected'; reason: string }>;                      // PROPOSED

export async function getDownloadUrl(
  eventId: EventId, fileId: string,
  requester: { kind: 'admin'; role?: MemberRole } | { kind: 'contact'; contactId: string },
): Promise<string>;                                                                            // PROPOSED, 1h presigned GET

export async function cleanupOrphanUploads(olderThanHours?: number): Promise<{ deleted: number }>; // PROPOSED
```

- `createUpload`/`finalizeUpload` consumed by: [./M05b-rich-ui-primitives.md](./M05b-rich-ui-primitives.md)'s `<FileUpload>` component (same agent, same day — the first consumer), [./M11-events-feature.md](./M11-events-feature.md) (event logo/background), [./M12-form-builder-core.md](./M12-form-builder-core.md)/[./M15-public-cfp-wizard.md](./M15-public-cfp-wizard.md)/[./M16-submit-pipeline.md](./M16-submit-pipeline.md) (CFP `file` field-type answers), [./M22-speaker-profile.md](./M22-speaker-profile.md) (headshot), [./M23-tasks-admin.md](./M23-tasks-admin.md)/[./M25-task-runtime.md](./M25-task-runtime.md) (file-request uploads).
- `getDownloadUrl` consumed by: [./M17-abstracts-table.md](./M17-abstracts-table.md) (`<SubmissionAnswers>` file-answer download links, dashed dependency), [./M25-task-runtime.md](./M25-task-runtime.md) (org-side upload viewer), [./M27-speakers-admin.md](./M27-speakers-admin.md) (speaker file downloads).
- `GET /f/[fileId]` consumed by every module rendering a public image: [./M22-speaker-profile.md](./M22-speaker-profile.md) (avatar), [./M32-public-schedule-gallery.md](./M32-public-schedule-gallery.md) (gallery headshots), [./M39-airtable-export.md](./M39-airtable-export.md) (Airtable "Headshot URL" field), [./M11-events-feature.md](./M11-events-feature.md) (branding preview).
- `cleanupOrphanUploads()` consumed by WS-F's [./M08-jobs-worker.md](./M08-jobs-worker.md) `daily` cron slot (`/api/jobs/cleanup` route) — cross-workstream wiring is WS-F's to build; this module only exports the function and documents the contract in this file.

## Step-by-step implementation

1. **Contract-first slice.** Write `src/shared/server/r2.ts` with the full typed signatures above, the `FileKind` type, and the kind-policy table (below) as an exported const — even before wiring the real R2 client, throw `AppError('INTERNAL', 'not wired')` from each fn body so every consumer (`M05b`, `M11`, `M22`, …) compiles and their own stub UIs render immediately. **Done when:** `pnpm typecheck` passes with these exports imported from a scratch file in every dependent feature folder.

2. **Kind policy table** (enforced server-side at both presign AND finalize — never trust the client-declared mime/size):

   | kind | mime allowlist | max size | access |
   |---|---|---|---|
   | `logo`, `background` | image/png, image/jpeg, image/webp (**no svg** — sanitizing SVG is a rabbit hole, excluded entirely) | 5 MB | public |
   | `headshot` | image/png, image/jpeg, image/webp | 5 MB | public |
   | `slide` | application/pdf, .ppt/.pptx, .key, .zip | 100 MB | private |
   | `attachment` | application/pdf, image/png, image/jpeg, .docx, .zip | 25 MB | private |
   | `upload` (file-request uploads) | caller-supplied `policyOverride.extensions` (from the owning `file_requests.accepted_extensions`), clamped to this table's hard ceiling of 100 MB / the request's `max_size_mb`, whichever is smaller | private |

   **Done when:** a unit test table asserts each kind accepts its allowlist and rejects one off-list mime + one oversize value.

3. **Object key scheme & filename sanitization.** Key = `evt_{eventId}/{kind}/{fileId}/{sanitizedFilename}` where `fileId = crypto.randomUUID()` and `sanitizedFilename` = NFC-normalize, strip path separators (`/`, `\`) and control chars, truncate to 128 chars keeping the extension. Never accept a client-supplied key. **Done when:** a unit test feeds `"../../etc/passwd"`, unicode combining marks, and a 300-char name and asserts the stored key contains none of the traversal segments and is ≤128 chars post-prefix.

4. **Bucket CORS** (one-time infra step, run once and documented in `DECISIONS.md`, not app code): `wrangler r2 bucket cors put sb-files --rules '[{"AllowedOrigins":["<APP_BASE_URL>","http://localhost:3000"],"AllowedMethods":["PUT","GET"],"AllowedHeaders":["content-type"],"MaxAgeSeconds":3600}]'`. **Done when:** a browser (not curl/Postman) successfully PUTs a file — CORS misconfiguration is invisible to curl and is the #1 "uploads mysteriously fail" trap.

5. **`POST /api/uploads/presign`.**
   - `defineHandler` (admin OR portal auth, either is valid depending on caller), zod input `{eventId, kind, filename, mime, sizeBytes, fileRequestId?}`.
   - Validates against the policy table (step 2); resolves `policyOverride` from the `file_requests` row when `fileRequestId` is present and `kind='upload'`.
   - Inserts a `file_assets` row. No separate `status` column exists on `file_assets` in the DDL — track pending-vs-ready by presence, not a flag: insert the row immediately (simpler, no schema change) and let `cleanupOrphanUploads` (step 9) delete rows with no HEAD-confirmed R2 object older than 24h. **Because there is no flag to "mark rejected", a rejected finalize DELETEs the row (step 6) — and consumers must therefore only persist a `fileId` into an owning column (`headshot_file_id`, `logo_file_id`, a `file` answer) AFTER `finalizeUpload` returns `ready`.** [M05b](./M05b-rich-ui-primitives.md)'s `<FileUpload onUploaded>` fires only on `ready`, which is what makes that rule automatic for UI callers.
   - Presigns the PUT via `aws4fetch` (15-min expiry, `Content-Type` signed into the request).
   - **Done when:** `curl -X POST /api/uploads/presign` with a valid admin session and a headshot-kind payload returns `{fileId, uploadUrl, requiredHeaders}`; an oversize/wrong-mime payload returns a typed 4xx before any R2 call.

6. **`POST /api/uploads/finalize`** — input `{fileId}`.
   - Server HEADs the object via the R2 binding: exists, size ≤ policy — the authoritative size check, since presign does not constrain actual bytes written.
   - For image kinds, sniffs the first 16 bytes via a ranged GET to confirm the magic bytes match the claimed mime (defends against a `.exe` renamed to `.png`).
   - Pass → row usable, `finalizeUpload` returns `{status:'ready'}`. Fail → delete the R2 object **and DELETE the `file_assets` row** (there is no `status` column to mark — step 5), then return `{status:'rejected', reason}`. Leaving the row behind would let a caller that already stored the `fileId` point at nothing.
   - **Done when:** uploading a valid PNG through steps 5–6 end-to-end on the deployed preview produces a fetchable `/f/{fileId}`; uploading a text file renamed `.png` is rejected at finalize.

7. **`GET /f/[fileId]`** — public serving route.
   - **No auth check for public kinds** (`logo`,`background`,`headshot`); 404 via `notFound()` for private kinds hit directly — they only serve through `getDownloadUrl`'s presigned GET, never through this route.
   - Streams from the R2 binding with headers: `Content-Type` **always read from `file_assets.mime`** (never R2 object metadata — a smuggled metadata mismatch must not become an XSS/MIME-sniff vector), `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, and `Content-Disposition: attachment` for any non-image kind ever served publicly (defense in depth — no current public kind is non-image, keep the branch so a future kind addition is safe by default).
   - Replacing a file (e.g. new headshot) always mints a **new** `fileId` and the caller repoints the owning column — file contents are immutable by construction, so the aggressive cache header is always correct.
   - **Done when:** `curl -I` against a seeded headshot's `/f/{id}` on the deployed preview shows the three headers above with the exact `Content-Type` stored in `file_assets.mime`, not R2's; this exact curl is reused by M10's post-deploy smoke.

8. **`GET /api/uploads/[fileId]/download-url`** — private-kind download.
   - `defineHandler` auth (admin OR portal); `getDownloadUrl` runs `canReadFile(eventId, fileId, requester)`: admin → any organizer/reviewer of the event; contact → owns the file (`uploaded_by_contact_id` match) OR the file is attached to a submission/task the contact participates in.
   - Returns a 1-hour presigned GET URL, never a public bucket path.
   - **Done when:** PGlite/unit test: contact A cannot fetch a download URL for contact B's private slide (403); an organizer of the same event can.

9. **`cleanupOrphanUploads(olderThanHours=24)`.**
   - Deletes `file_assets` rows (+ their R2 objects) that were never referenced by any owning column (`contacts.headshot_file_id`, `events.logo_file_id`/`background_file_id`, `file_uploads.file_asset_id`, `submission_answers` file-type values) and are older than the threshold.
   - Exported, not wired to a route here — WS-F's M08 wires it to the daily cron slot.
   - **Done when:** a unit test seeds one referenced + one unreferenced 25-hour-old row and asserts only the unreferenced one is deleted.

## Acceptance criteria

Copied verbatim from the catalog (PLAN.md §4, M07), plus verification commands:

- Browser upload of a headshot succeeds on the deployed preview (CORS proven) — manual check: DevTools Network tab shows the PUT succeeding from `https://<preview>.workers.dev`, not just curl.
- Oversize/wrong-mime rejected server-side — `pnpm vitest run src/shared/server/r2.test.ts` (policy table cases from step 2).
- Public file cached-immutable with correct headers — `curl -I https://<preview>/f/{seededHeadshotId}` shows `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, correct `Content-Type`; this exact assertion is reused verbatim in M10's `scripts/post-deploy-smoke.sh`.
- Private file 403s without authz — `pnpm vitest run src/shared/server/r2.test.ts -t authz`.

## Guardrails

- **Never proxy file bytes through the Worker.** Workers request-body limits make it fragile; the whole design is presigned PUT direct-to-R2 from the browser. If aws4fetch presigning fails its spike (deferred Sat-AM check), the pre-decided fallback is a route-handler proxy for uploads ≤25 MB using the R2 binding directly (documented in platform-integrations.md §4.3/V4) — adopt it the same hour, keep presign for `slide` only if even that is shaky.
- **`file_assets.mime` is the only source of truth for served `Content-Type`.** Never read R2 object metadata for this — an attacker-controlled metadata field must never become a served header.
- **Replace = new fileId, never overwrite a key.** This is what makes `max-age=31536000, immutable` safe; do not "reuse" a key for a re-upload anywhere in the codebase.
- **Client-supplied R2 keys are never accepted.** The key is always server-generated from `evt_{eventId}/{kind}/{fileId}/{sanitizedFilename}`.
- **SVG is excluded** from every public image kind — no exceptions, do not special-case it later without re-reading the sanitizer rabbit hole this avoided.
- **Module boundary:** `shared/server/r2.ts` is the only file in the repo that imports the R2 binding or `aws4fetch`. CI's invariant grep (M01 §10, **grep #11 — it ships Friday with the rest of the table, so no mid-build edit is needed**) enforces "no direct R2 calls outside `shared/server/r2.ts`". `scripts/check-invariants.sh` is **M01-owned**: if the grep is missing or needs adjusting, that is an **architect-labeled one-line PR**, never a direct edit from this lane (two lanes editing the CI file mid-Saturday is exactly the hot-file collision risk #8 exists to prevent). Do not let a feature agent hand-roll their own presign call.
- **IDOR on `getDownloadUrl`:** always check `(eventId, fileId, requester)` together — a contact id from one event must never unlock a file in another event, even if both are technically the caller's session.
- **Orphans are acceptable hackathon debt, cleanup is best-effort.** Do not build retry/backfill machinery around `cleanupOrphanUploads` — one daily pass is the entire budget (per platform-integrations.md §3.1/§4.3).

## Notes

- **The presigned PUT is signed for a staging key**, and finalize server-side copies the object to `evt_{eventId}/{kind}/{fileId}/{filename}` before inspecting it. A presigned URL stays usable until it expires, so publishing to the key it can write would let a validated object be replaced after the fact — under a `max-age=31536000, immutable` header. The published key in step 3 is unchanged; staging is an implementation detail of step 6.
- **SigV4 cannot bind the uploaded size.** `Content-Length` is a forbidden header for browser `fetch`, so signing it risks breaking every upload. Oversize bytes are rejected and deleted at finalize, and an abandoned staging object is swept within 24h. The durable fix is a **provisioning follow-up: an R2 lifecycle rule expiring the `staging/` prefix** on `sb-files-preview` and `sb-files` — infrastructure, not app code, and not this lane's to run.
- **Invariant grep #11 is still missing** from `scripts/check-invariants.sh` — nothing enforces "no direct R2 calls outside `shared/server/r2.ts`" yet. That file is M01-owned, so it needs an architect-labeled one-line PR (guardrails, above). Until then the module boundary is convention, not CI.
- **Step 4 (browser CORS proof) and the deployed AC are not met.** Bucket CORS is configured on both buckets, but no browser PUT and no `curl -I /f/{id}` has run against the preview, and production S3 credentials for `sb-files` do not exist yet.

## If blocked

If M01's R2 bucket/CORS isn't provisioned yet: finish steps 1–3 and 6 (finalize logic, key scheme, policy table) fully unit-tested against the mocked binding; write the `/f/[fileId]` route and its header logic against a fixture `file_assets` row so it's a one-line swap once the binding lands. If M04's `getEnv()` isn't ready: hardcode the two or three env reads behind a local `getR2Env()` shim in `r2.ts` with a `// TODO(M04): swap to shared getEnv()` comment — do not block on it. Once unblocked, move to M05b (`<FileUpload>` component, same agent) — it is the first real consumer and will immediately exercise every code path here.
