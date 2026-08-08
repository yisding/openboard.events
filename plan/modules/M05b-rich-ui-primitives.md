# M05b — Rich primitives

| | |
|---|---|
| **Status** | NOT STARTED |
| **Workstream / executing agent** | **WS-D agent (Speaker Portal)** — its first consumer. Catalogued under WS-A but executed on WS-D as a declared temporary cross-folder ownership grant on `src/shared/ui/app` (rich half) |
| **Scheduled** | **Sat AM: Step 1 contract-first slice (the six prop types) pushed the hour [M05a](./M05a-admin-shell-ui.md) lands** — it is what unblocks [M12](./M12-form-builder-core.md) (B1), [M22](./M22-speaker-profile.md), [M23](./M23-tasks-admin.md), [M26](./M26-resource-pages.md) (WS-C) and [M37](./M37-comms-admin-ui.md) (WS-F), the widest UI blocker in the build. **Sat PM: internals**, with `<FileUpload>` wired once [M07](./M07-r2-storage.md)'s presign is live. Does **not** gate CP1 |
| **Size** | M |
| **Paths owned** | `src/shared/ui/app/rich-text-editor.tsx`, `src/shared/ui/app/rich-text-view.tsx`, `src/shared/ui/app/datetime-picker.tsx`, `src/shared/ui/app/file-upload.tsx`, `src/shared/ui/app/stat-tile.tsx`, `src/shared/ui/app/donut.tsx`, `src/app/kitchen-sink/rich/page.tsx`. **NOT owned:** the core set and the `(admin)` layout → [M05a](./M05a-admin-shell-ui.md) |

## Objective
The five primitives that every rich editing surface needs exist behind stable props: a TipTap editor that round-trips sanitized HTML, the single `<RichTextView>` that is the only `dangerouslySetInnerHTML` site in the repo, an event-timezone `<DateTimePicker>`, a presigned-R2 `<FileUpload>` with progress and client-side downscale, and the two dashboard display primitives. The TipTap client-bundle budget is asserted in CI the moment this lands.

## Dependencies
- **Hard (blocks start):** [M04](./M04-shared-libs.md) (`sanitize`, `formatInZone`/`zonedInputToUtc`, `LIMITS.plainTextLength`), [M05a](./M05a-admin-shell-ui.md) (shadcn primitives + `cn` + the kitchen-sink pattern). **That is all Step 1 needs** — six prop types, ~20 minutes.
- **Soft (start against stub/fixture):** [M07](./M07-r2-storage.md) — **only `<FileUpload>`'s internals; every other primitive needs M04 + M05a alone.** Build and demo `<FileUpload>` against M07's **Phase-0 throwing stubs** by mocking the presign response shape (`{uploadUrl, fileId, headers}`); swap to the real endpoint the same afternoon. `<RichTextEditor>`/`<RichTextView>` need nothing beyond `sanitize`.

## Provides (interfaces others consume)
```ts
<RichTextEditor value={html} onChange={(html) => …} maxChars={LIMITS.RICHTEXT} placeholder? />
<RichTextView html={string} profile="default" | "wide" />      // THE only dangerouslySetInnerHTML site
<DateTimePicker value={ISOString|null} onChange tz={event.timezone} mode="datetime"|"date" clearable />
<FileUpload eventId kind={FileKind} onUploaded={(fileId, meta) => …} accept maxSizeMb currentFileId? />
// onUploaded fires ONLY after M07's finalizeUpload returns {status:'ready'} — a rejected finalize deletes
// both the R2 object and the file_assets row, so a caller must never persist a fileId before then.
<StatTile label value hint? tone? href? />
<Donut segments={[{label, value, color}]} size? />             // one SVG, no charts library
```
Consumers: `<RichTextEditor>` → [M11](./M11-events-feature.md) (theme/welcome), [M12](./M12-form-builder-core.md) (section instructions), [M14](./M14-form-settings-notifications.md) (success page), [M22](./M22-speaker-profile.md) (bio), [M23](./M23-tasks-admin.md) (task description), [M26](./M26-resource-pages.md) (page body, `wide`), [M28](./M28-sessions-crud.md) (session description), [M37](./M37-comms-admin-ui.md) (template bodies). `<RichTextView>` → every render surface incl. [M15](./M15-public-cfp-wizard.md), [M17](./M17-abstracts-table.md), [M21](./M21-portal-shell.md), [M32](./M32-public-schedule-gallery.md). `<DateTimePicker>` → [M11](./M11-events-feature.md), [M14](./M14-form-settings-notifications.md), [M23](./M23-tasks-admin.md), [M28](./M28-sessions-crud.md). `<FileUpload>` → [M11](./M11-events-feature.md), [M15](./M15-public-cfp-wizard.md), [M22](./M22-speaker-profile.md), [M25](./M25-task-runtime.md). `<StatTile>`/`<Donut>` → [M38](./M38-dashboard.md).

## Step-by-step implementation

### 1. CONTRACT-FIRST SLICE — the six prop types, placeholder renders (first 20 minutes, **Sat AM, not PM**)
Create all six files exporting the exact props above with plain-HTML placeholder bodies (`<textarea>` for the editor, `<input type="datetime-local">` for the picker, `<input type="file">` for upload). **Push before anything else in this module**: [M12](./M12-form-builder-core.md), [M22](./M22-speaker-profile.md), [M23](./M23-tasks-admin.md), [M26](./M26-resource-pages.md) and [M37](./M37-comms-admin-ui.md) can then write their forms against final props while the internals land. This slice needs M04 + M05a only — **do not wait on [M07](./M07-r2-storage.md)**; five lanes are downstream of it.
- **Done when:** `pnpm typecheck` green and `import { RichTextEditor } from '@/shared/ui/app/rich-text-editor'` resolves from a feature folder.

### 2. `<RichTextView>` — the single unsafe render site
`'use server'`-safe (no client JS). Body: `<div className="prose prose-sm" dangerouslySetInnerHTML={{__html: sanitize(html, {profile})}} />`. It **sanitizes again on render** even though every write path already sanitized — belt and braces, because stored XSS on a public/embed page is a judged failure (risk #9).
Add the file-header comment: *"This is the ONLY `dangerouslySetInnerHTML` in the repo. `scripts/check-invariants.sh` grep #1 enforces uniqueness. Do not add a second one; extend this component instead."*
- **Done when:** rendering the seeded `<img src=x onerror=alert(1)>` probe produces no alert and no `onerror` attribute in the DOM, and `pnpm invariants` still passes with exactly one hit allowed.

### 3. `<RichTextEditor>` — TipTap, client-only, budgeted
- `'use client'` + `next/dynamic` with `ssr: false` so TipTap never enters the server graph.
- StarterKit trimmed to the sanitizer's allowlist: paragraph, headings 1–3, bold, italic, underline, bullet/ordered list, blockquote, code, link, hardBreak. **No image node, no table, no color/font extensions** — anything the sanitizer strips must not be offerable in the toolbar, or organizers author content that silently disappears.
- Link input validates `^https?:|^mailto:` before insert.
- Live character counter using **`plainTextLength()` from [M02](./M02-shared-contracts.md)** — the same function the server `.refine()` uses, so client and server counts cannot drift. Counter shows `n / max` and turns red past the limit; the parent still validates server-side.
- `onChange` emits `sanitize(editor.getHTML())` — the stored value is sanitized HTML (resolution #2), not TipTap JSON.
- **Done when:** typing formatted content, saving, reloading, and re-editing preserves formatting exactly (round-trip test in the kitchen sink), and a pasted `<script>` is gone from the emitted value.

### 4. CI bundle-size gate (this is the module that turns it on)
Add to [M01](./M01-scaffold-ci-deploy.md)'s CI a step asserting the **client** bundle for a route importing the editor stays under budget, and that gzipped `.open-next/worker.js` stays ≤ 8 MiB. Record the measured TipTap delta in `DECISIONS.md`. If the editor pushes past budget, drop extensions (blockquote/code first) rather than lazy-hacking — the fallback is a plain `<textarea>` with the same props, and every consumer keeps compiling.
- **Done when:** CI prints the before/after client-bundle numbers and is green.

### 5. `<DateTimePicker>` — event timezone, labeled, clearable
- Renders and parses **in the event timezone**, always showing the zone label ("October 12th, 2026 at 9:00 AM **PDT**") — the real product's Event Details screen shows exactly this, including the **×** clear button.
- Emits an ISO-8601 **UTC** string via `zonedInputToUtc(localValue, tz)`; never emits a local naive string.
- `mode="date"` (for task due dates) emits `endOfDayInTz(dateISO, tz)` — a date-only due date is end-of-day in event tz, converted here, once ([M23](./M23-tasks-admin.md) depends on this).
- Clearing emits `null` (unscheduled sessions, no close date).
- **Done when:** picking "Oct 12 2026, 9:00 AM" with tz `America/Los_Angeles` emits `2026-10-12T16:00:00.000Z`, and the DST-boundary date Mar 8 2026 round-trips correctly.

### 6. `<FileUpload>` — presigned PUT, progress, client downscale
Flow (platform-integrations §4.3): `createUpload({eventId, kind, filename, mime, sizeBytes})` → `PUT` **directly to R2** with XHR (progress events; never proxy bytes through the Worker) → `finalizeUpload(fileId)` → `onUploaded(fileId)`.
- **Client downscale before upload** for `headshot`/`logo`/`background`: canvas, max edge 1024px (headshot) / 600px (logo), JPEG or WebP q≈0.85. ~40 lines; it removes the entire server-side image-processing risk class (no sharp on Workers).
- Enforce the kind policy client-side for UX (`headshot`: png/jpeg/webp ≤5 MB; `slide`: pdf/ppt/pptx/key/zip ≤100 MB; `attachment`: pdf/png/jpeg/docx/zip ≤25 MB) while knowing the **server is authoritative** at presign and finalize.
- States: idle / dragging / uploading (% bar) / verifying / done (thumbnail or filename + Replace) / **error with retry and the server's reason** ("file too large", "unsupported type").
- Replace = new upload → new `fileId`; the caller repoints its column. Objects are immutable by construction, which is what makes `/f/{fileId}` cacheable forever.
- **Done when:** a headshot uploads on the **deployed preview** (proving CORS), a 20 MB PNG is rejected with a readable message, and the resulting `/f/{fileId}` URL renders in an `<img>`.

`<FileUpload>` state machine (build it explicitly; four modules depend on every branch being designed):
```
idle ──drop/pick──▶ validating ──fail──▶ error(reason) ──retry──▶ idle
                        │pass
                        ▼
                   downscaling (images only)
                        ▼
                   presigning ──fail──▶ error("couldn't start upload")
                        ▼
                   uploading(%) ──abort──▶ idle    ──network fail──▶ error(retry)
                        ▼
                   finalizing ──reject──▶ error(server reason: size/mime/magic-bytes)
                        ▼
                   done(fileId) ──replace──▶ idle   (new fileId; caller repoints its column)
```

### 7. `<StatTile>` and `<Donut>`
- `<StatTile>`: label, big value, optional hint line, optional `href` making the whole tile a deep link ([M38](./M38-dashboard.md)'s attention strip), tone variants (default/warning/danger), and a skeleton state. Renders `<Dash>` for null values.
- `<Donut>`: one hand-written SVG, ≤60 lines, segments with labels and a centre total. **No charts library** (bundle + speed bonus). Handles the all-zero case by rendering an empty ring plus "No data yet" rather than dividing by zero — [M38](./M38-dashboard.md)'s confirmation-mix donut on the empty second event hits this.

### 8. `src/app/kitchen-sink/rich/page.tsx`
Separate route from [M05a](./M05a-admin-shell-ui.md)'s page so the two modules never touch the same file. Renders: the editor with a 5,000-char counter, `<RichTextView>` on both profiles side by side (with an `<iframe>` and a `<script>` in the source to show the difference), a `<DateTimePicker>` in two timezones, a `<FileUpload>` for `headshot`, three `<StatTile>`s, and a `<Donut>` plus an empty `<Donut>`.

## Acceptance criteria
Catalog AC, verbatim: *kitchen-sink page extended; RichTextEditor round-trips sanitized HTML; bundle-size gate green.*

```bash
open http://localhost:3000/kitchen-sink/rich
pnpm vitest run src/shared/ui/app/rich-text-view.test.tsx   # XSS probe neutralized; wide vs default iframe
pnpm build && pnpm build:worker                              # bundle gate prints numbers, stays under budget
pnpm invariants                                              # exactly one dangerouslySetInnerHTML site
# deployed preview:
#   upload a headshot from a browser (CORS proof) → /f/{fileId} returns image with immutable cache headers
```

## Guardrails
- **`<RichTextView>` uniqueness is a CI invariant** (grep #1). Adding a second `dangerouslySetInnerHTML` — even "just for the email preview" — breaks the build. Extend the component.
- **The `wide` profile is for `resource_pages` only** ([M26](./M26-resource-pages.md)). Passing `profile="wide"` from any other surface is a review-blocker: it is the one place iframes are permitted, and it is not a public page.
- **Organizer-authored HTML including email template bodies passes `sanitize()` on save** (resolution #2) — `<RichTextEditor>`'s `onChange` sanitizing is a convenience, not the guarantee; the server mutation sanitizes too.
- **TipTap is client-only.** If it appears in the server graph the OpenNext build gets fat and may fail on workerd. Keep the `next/dynamic` boundary.
- **Char limits count plain-text code points** via the shared `plainTextLength` — never `html.length`. A bio of 5,000 characters with formatting must not be rejected because of markup.
- **`<DateTimePicker>` never does its own zone math** — `zonedInputToUtc`/`formatInZone`/`endOfDayInTz` only (grep #3 makes importing `date-fns` here a CI failure).
- **Uploads never proxy through the Worker** (request-body limits). If presign is failing, the fallback is [M07](./M07-r2-storage.md)'s proxy route for ≤25 MB kinds — a decision made there, not improvised here.
- Empty-state edge cases: `<FileUpload>` with no current file, `<Donut>` with all-zero segments, `<RichTextView>` with `null`/`''` html (render nothing, not "null").
- Concurrent-edit edge case: the editor is uncontrolled internally; when a parent 409s and refetches, it must remount with the fresh value — expose a `key`-able `value` prop and document that consumers change `key` on refetch.

## If blocked
- **[M07](./M07-r2-storage.md) presign not ready:** build `<FileUpload>` against a local mock returning a fake presigned URL to a `PUT`-accepting test endpoint; the component's contract does not change.
- **TipTap fights the bundle or workerd:** ship the pre-decided fallback — a `<textarea>` behind the identical `<RichTextEditor>` props plus the same char counter, with `sanitize()` on change. Every consumer keeps compiling; note the deviation in `DECISIONS.md` and the demo script.
- **Done early:** wire the client-downscale util and measure a 4 MB phone photo end-to-end (this is the real judge path for headshots), then start [M21](./M21-portal-shell.md), the WS-D agent's next module.
