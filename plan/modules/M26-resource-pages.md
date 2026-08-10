# M26 — Resources / wiki pages

| | |
|---|---|
| **Status** | IN PROGRESS — **IMPLEMENTED on branch (rev. 10 run)**, no active claim. `src/features/portal/resources/server/{queries,mutations}.ts` now provide `listResourcePages`/`getResourcePage`/`saveResourcePage`/`deleteResourcePage`/`reorderResourcePages` (slugify + reserved-word rejection, `sanitize(html,{profile:'wide'})`, STALE_WRITE on write conflicts), a real admin `<DataTable>` CRUD UI at `/events/[eventId]/resources`, and portal list/detail pages that gate on `publishedOnly` with `notFound()` on an unpublished/nonexistent slug. `scripts/seed/resources.ts` adds 3 seeded pages including an iframe/script/onerror probe. Remaining before `DONE`: running the seed script against a live database and deployed/browser AC. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-C · Submissions Review — **executing agent differs from the feature folder**: WS-C owns `features/portal/resources/**` by declared temporary file-ownership on Monday (PLAN §4/§6). WS-D owns the rest of `features/portal`. |
| **Scheduled** | **Mon** (CP3 demo bar: "resources page with iframe embed"). |
| **Size** | S (~2h) |
| **Paths owned** | `src/features/portal/resources/server/queries.ts` · `src/features/portal/resources/server/mutations.ts` · `src/features/portal/resources/components/**` · `src/features/portal/resources/index.ts` · `src/app/(admin)/events/[eventId]/resources/page.tsx` · `src/app/(portal)/portal/[eventSlug]/resources/page.tsx` · `src/app/(portal)/portal/[eventSlug]/resources/[slug]/page.tsx` · `src/app/api/internal/resources/[eventId]/route.ts` · `src/app/api/internal/resources/[eventId]/[pageId]/route.ts` · `scripts/seed/resources.ts` |

## Objective

Brief feature #8: organizers CRUD wiki/resource pages (title, slug, rich-text body, publish toggle, ordering) under Portals → Resources; speakers read them in the portal at `/portal/[eventSlug]/resources`. The body uses the **wide sanitizer allowlist that permits `<iframe>`** — a YouTube or Loom embed pasted into a page renders in the portal, while `<script>` and event handlers are stripped on save and again on render. Unpublished pages are invisible to speakers.

## Dependencies

**Hard (blocks start):**
- [M03](./M03-db-schema-migrations.md) — `resource_pages` (id, event_id, title, slug, body_html, sort_order, published, created_at, updated_at, `UNIQUE(event_id, slug)`) migrated on `sb-dev`.
- [M04](./M04-shared-libs.md) — **`sanitize(html, {profile: 'default' | 'wide'})`** with two profiles; this module is the **only** `wide` caller (M04 §5 says so by name). The profile is called **`wide`**, not `'resource'`. `slug.ts` (`slugify` + reserved words), `defineHandler`, `errors.ts`.
- [M21](./M21-portal-shell.md) — the `(portal)` layout, portal nav with a **Resources** item, and `requirePortal(eventSlug)` returning `{ contactId, eventId }`.
- [M06a](./M06a-admin-auth.md) — `requireAdmin(eventId)` for the admin side.

**Soft (start against stub/fixture):**
- [M05b](./M05b-rich-ui-primitives.md) — `<RichTextEditor>` and `<RichTextView>`. `<RichTextView>` is the **only** `dangerouslySetInnerHTML` site in the repo, and it **already** takes the prop this module needs: `<RichTextView html profile="default" | "wide" />` (M05b's Provides block). Use `profile="wide"`; there is no `allowlist` prop and nothing for WS-D to add. Until the editor lands, the body editor is a plain `<textarea>` holding HTML source (which is the honest UX for "HTML embed support" anyway — keep the toggle permanently).
- [M09](./M09-seed-demo-script.md) — orchestrator composition of `scripts/seed/resources.ts` (one line in the architect-owned `scripts/seed/index.ts`; request it when the file lands). Runs standalone meanwhile.

## Provides (interfaces others consume)

```ts
// src/features/portal/resources/index.ts  — re-exported from the portal barrel by WS-D on request
export async function listResourcePages(eventId: EventId, opts?: { publishedOnly?: boolean }): Promise<ResourcePageRow[]>;
export async function getResourcePage(eventId: EventId, slug: string, opts?: { publishedOnly?: boolean }): Promise<ResourcePageDTO | null>;
export async function saveResourcePage(eventId: EventId, input: ResourcePageInput, expectedUpdatedAt?: string): Promise<{ pageId: string }>;
export async function deleteResourcePage(eventId: EventId, pageId: string): Promise<void>;
export async function reorderResourcePages(eventId: EventId, orderedIds: string[]): Promise<void>;

type ResourcePageRow  = { id: string; title: string; slug: string; published: boolean; sortOrder: number; updatedAt: string };
type ResourcePageDTO  = ResourcePageRow & { bodyHtml: string | null };
type ResourcePageInput = { id?: string; title: string; slug?: string; bodyHtml: string; published: boolean; sortOrder?: number };
```

Routes: admin `/events/[eventId]/resources`; portal `/portal/[eventSlug]/resources` (list) and `/portal/[eventSlug]/resources/[slug]` (page). API: `GET|POST /api/internal/resources/[eventId]`, `GET|PATCH|DELETE /api/internal/resources/[eventId]/[pageId]`.

**PROPOSED:** all signatures and both route paths (the catalog only says "resources pages"). The admin route slots under the sidebar's PORTALS section next to Tasks/Forms/File Requests.

**Consumers:** [M21](./M21-portal-shell.md) (nav item + a "Resources" home widget link if it wants one). Nothing else.

## Step-by-step implementation

1. **Contract-first slice.** `src/features/portal/resources/index.ts` with the five signatures as throwing stubs plus the three types; ask WS-D to add `export * from './resources'` to the portal barrel (their file). Add `scripts/seed/resources.ts` with two pages: "Speaker Guide" (published, headings + list + a link) and "Venue & Travel" (published, containing a **YouTube iframe** and a `<script>alert(1)</script>` + `<img src=x onerror=alert(1)>` probe that must be stripped), plus one **unpublished** "Internal Notes" page.
   **Done when:** `pnpm tsc --noEmit` is green and `pnpm tsx scripts/seed/resources.ts` inserts 3 rows idempotently.

2. **Sanitizer profile check (do this before any UI).** Confirm `sanitize(html, {profile: 'wide'})` in [M04](./M04-shared-libs.md) permits `iframe[src|width|height|allow|allowfullscreen|frameborder|title]` with `src` restricted to `https:` on an allowlisted host set (`www.youtube.com`, `www.youtube-nocookie.com`, `player.vimeo.com`, `www.loom.com`, `docs.google.com` — **RESOLVED, rev. 3 delta #19: this list is authoritative**, exported from [M04](./M04-shared-libs.md)'s `sanitize.ts` as `WIDE_IFRAME_HOSTS`; extend it there, never locally), plus `img[src|alt]`, `a[href]` (`https?:`/`mailto:`), headings, lists, `blockquote`, `pre/code`, `hr`, `table`-family. Everything else — `script`, `style`, `object`, `embed`, `on*` handlers, `javascript:` URLs — is stripped. If the allowlist is missing, add it in `shared/lib/sanitize.ts` with a unit test (that file is M04's; a small architect-labelled PR, not a local copy).
   **Done when:** `pnpm vitest run src/shared/lib/sanitize.test.ts` proves the YouTube iframe survives; `<iframe src="http://evil">`, `<iframe src="https://evil.example">` (https but not allowlisted) and `<iframe srcdoc="<script>alert(1)</script>">` do not (delta #19); and `<script>`/`onerror` are removed.

3. **Server queries + mutations.** `listResourcePages` (order by `sort_order, title`), `getResourcePage` (by slug; `publishedOnly` for the portal path). `saveResourcePage`: slug from `slugify(title)` when absent, uniqueness per event (map the unique violation to a field error "That URL is already used"), reserved words rejected via `slug.ts`, `bodyHtml` through `sanitize(html, {profile:'wide'})` **on save**, `expectedUpdatedAt` → 409 `STALE_WRITE`. `deleteResourcePage` behind `<ConfirmDialog>`. `reorderResourcePages` renumbers the whole list transactionally (no fractional keys).
   **Done when:** `curl -X POST "$BASE/api/internal/resources/$EVENT_ID" -b admin.cookie -d '{"title":"Speaker Guide","bodyHtml":"<p>hi</p><script>alert(1)</script>","published":true}'` returns a pageId and `SELECT body_html FROM resource_pages` shows no `<script>`.

4. **Admin UI** — `/events/[eventId]/resources`: `<DataTable>` (Title, `/slug`, Published badge, Updated `<TzTime>`, ↑/↓ reorder, Edit, Delete) + "New page" button. Editor page/drawer: Title, Slug (auto-filled from title, editable, shown as `…/resources/<slug>`), Body (`<RichTextEditor>` + an **"HTML source"** toggle exposing a monospace `<textarea>` — this is the "HTML embed support" affordance), Published switch, Save (+ "View in portal" link). `<EmptyState>`: "No resource pages yet — add a Speaker Guide, venue info, or an FAQ."
   **Done when:** creating a page from the UI and toggling Published is reflected on the portal list within one refetch.

5. **Portal list** — `/portal/[eventSlug]/resources`: `requirePortal(eventSlug)`, then `listResourcePages(eventId, { publishedOnly: true })` rendered as cards/list rows (title + first ~140 plaintext chars) linking to the page. `<EmptyState>`: "No resources have been published yet."
   **Done when:** the seeded unpublished page is absent and the two published ones are listed in `sort_order`.

6. **Portal page** — `/portal/[eventSlug]/resources/[slug]`: `getResourcePage(eventId, slug, { publishedOnly: true })`; `null` → `notFound()` (a 404, never a 403 that reveals the page exists). Render the body through `<RichTextView html={page.bodyHtml} profile="wide" />`. Mobile-first: iframes get a responsive wrapper (`aspect-ratio: 16/9; width:100%`) so a YouTube embed does not overflow a 390px viewport.
   **Done when:** on a 390px viewport the seeded YouTube embed plays inside the layout and the XSS probes do not fire.

7. **Tests.** `src/features/portal/resources/server/mutations.test.ts` (PGlite): slug uniqueness per event, reserved slug rejected, sanitize-on-save strips `<script>`, `publishedOnly` hides drafts, cross-event isolation (page in event B invisible from event A).
   **Done when:** `pnpm vitest run src/features/portal/resources` is green.

## Acceptance criteria

**Catalog AC (verbatim):** a page embedding a YouTube iframe renders in the portal; a `<script>` in the body is stripped; unpublished pages hidden.

Verification:
- `pnpm vitest run src/shared/lib/sanitize.test.ts` (`wide`-profile cases) and `pnpm vitest run src/features/portal/resources`.
- `curl -s "$BASE/portal/$EVENT_SLUG/resources/venue-travel" -b portal.cookie | grep -c '<iframe'` → 1; `| grep -c '<script'` → 0.
- `curl -s -o /dev/null -w '%{http_code}' "$BASE/portal/$EVENT_SLUG/resources/internal-notes" -b portal.cookie` → 404.
- Manual on the deployed preview at 390px width: the embed renders and plays.

## Guardrails

- **One renderer.** `<RichTextView>` is the sole `dangerouslySetInnerHTML` site; the CI grep fails the build on a second one. Need a capability it lacks → ask WS-D ([M05b](./M05b-rich-ui-primitives.md)) for a prop.
- **Sanitize twice** (belt + braces): on save (mutation) and on render (`RichTextView`). Both use the same **`wide` profile** from `shared/lib/sanitize.ts` — never a locally-defined allowlist.
- **The wide allowlist is scoped to resource pages only.** Do not let it leak into bios, task descriptions, session descriptions or email bodies — those keep the narrow allowlist (an iframe in an email body or a public gallery bio is a judged failure).
- **R4 scoping:** `(eventId, …)` first everywhere; portal reads resolve the event from the slug then pass it explicitly; `publishedOnly` is enforced server-side, never by a client filter.
- **R10/empty states:** admin list empty, portal list empty, a page with an empty body — all designed; verify on the empty second event.
- **Slugs** go through `shared/lib/slug.ts` including its reserved-word list; a page slugged `api` or `login` must be rejected at save.
- **R11:** the editor sends `expectedUpdatedAt`; two admins editing the same page produce a friendly 409, not a silent overwrite.
- **Cross-folder ownership:** you are a guest in `features/portal`. Touch only `features/portal/resources/**` and the three route files listed above; any change to the portal shell, nav or barrel is a request to WS-D, not an edit.

## If blocked

1. If [M21](./M21-portal-shell.md)'s shell is not ready: build and verify the **admin** half plus the sanitizer tests; the portal pages are then ~30 minutes. A temporary unstyled portal route guarded by `requirePortal` is acceptable to prove the render.
2. If `<RichTextEditor>` is missing: ship with the HTML-source `<textarea>` only — it satisfies the brief's "HTML embed support" and is the path the demo uses anyway.
3. Next in your lane on Monday: [M27](./M27-speakers-admin.md) (the other WS-C portal-admin module), then [M19](./M19-evaluation-scoring.md) finish.
4. **Standing WS-C duty (PLAN §6):** WS-C is designated swarm capacity for WS-B from Sun noon; if the CP2 spine was red at the Sunday-noon golden-path check, M26 is one of the first things to defer (it is small and independent) — pick up B2's wizard/pipeline tasks instead and return here once the spine is green.
