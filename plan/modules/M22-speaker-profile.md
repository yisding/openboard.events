# M22 — Speaker profile

| | |
|---|---|
| **Status** | IN PROGRESS — PR #4 contains a localStorage **STACK-DEMO** profile; authorized server writes, field-scoped contacts, real R2 headshot upload, and deployed AC remain open. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-D agent (`features/portal`). |
| **Scheduled** | Sun, alongside M25's manual+file modes, per WS-D's order (`M22 + M25 manual/file modes (Sun)`). |
| **Size** | M |
| **Paths owned** | `src/features/portal/profile/server/queries.ts`, `src/features/portal/profile/server/mutations.ts`; `src/features/portal/profile/components/**`; `src/app/(portal)/portal/[eventSlug]/profile/page.tsx`; `src/app/api/internal/portal/profile/route.ts`; (append-only: one export block in `src/features/portal/index.ts`) |

## Objective

The speaker-editable profile page: bio (rich text, 5,000-char limit), name/salutation/honorific/pronouns/gender, four link URLs, and headshot upload. When done, a speaker edits their bio and uploads a headshot, saves, sees a toast, and the same data is what feeds the public speaker gallery (`published_speakers_v`) and the dashboard's missing-assets alert — this module is the only writer of these `contacts` columns from the speaker side.

## Dependencies

- **Hard (blocks start):** [./M21-portal-shell.md](./M21-portal-shell.md) (portal shell/layout to render inside, `requirePortalContext`). [./M07-r2-storage.md](./M07-r2-storage.md) (`createUpload`/`finalizeUpload` for the headshot). [./M05b-rich-ui-primitives.md](./M05b-rich-ui-primitives.md) (`<RichTextEditor>`, `<FileUpload>`) — all three land Sat, so this module is unblocked from Sunday morning.
- **Soft:** none beyond the above — this module has no dashed/fixture dependencies; everything it needs is real by Sunday.

## Provides (interfaces others consume)

```ts
// appended to src/features/portal/index.ts
export async function getSpeakerProfile(eventId: EventId, contactId: string): Promise<SpeakerProfileDTO>;
export async function updateProfile(eventId: EventId, contactId: string, patch: ProfilePatch): Promise<SpeakerProfileDTO>;
```

- `getSpeakerProfile` consumed by: [./M21-portal-shell.md](./M21-portal-shell.md)'s Home "My Profile" widget (already reads `contacts` directly for the summary — no hard dependency), [./M27-speakers-admin.md](./M27-speakers-admin.md) (WS-C's speaker detail admin page, dashed).
- `updateProfile` is the **only** writer of `contacts.bio_html/salutation/honorific/first_name/last_name/pronouns/gender/headshot_file_id/linkedin_url/twitter_url/facebook_url/website_url` from the portal side — internally it calls **`updateContactFields(tx, eventId, contactId, partial)` from the `@/features/portal` barrel** — the helper lives in `src/features/portal/server/contacts.ts`, owned and shipped by [./M21-portal-shell.md](./M21-portal-shell.md) Step 0 (not by M06b, which is only another caller) (resolution #13: field-scoped, never whole-row; every writer of `contacts` goes through this helper). No other module in this codebase writes these columns except [./M27-speakers-admin.md](./M27-speakers-admin.md)'s admin correction and [./M25-task-runtime.md](./M25-task-runtime.md)'s form-task write-back, both also through `updateContactFields`.
- Profile data (bio/headshot/links) feeds `published_speakers_v` (→ WS-E's gallery, [./M32-public-schedule-gallery.md](./M32-public-schedule-gallery.md)) and `missing_assets_v` (→ WS-F's dashboard, [./M38-dashboard.md](./M38-dashboard.md)) — pure DB read-model consumption, no code coupling.

## Step-by-step implementation

1. **Contract-first slice.** Add `getSpeakerProfile`/`updateProfile` typed stubs to `src/features/portal/index.ts` (append, do not touch M21's existing exports) returning/accepting the `SpeakerProfileDTO`/`ProfilePatch` zod shapes below. **Done when:** `pnpm typecheck` passes.

2. **Contracts (local to this module unless M02 already stubs them — check `@/shared/contracts/speaker.ts` first; if absent, define here as PROPOSED and flag for promotion):**
   ```ts
   const profilePatchSchema = z.object({
     bioHtml: z.string().max(20000).optional(),      // raw HTML pre-sanitize; plaintext length enforced below
     salutation: z.string().max(50).optional(),
     honorific: z.string().max(50).optional(),
     firstName: z.string().min(1).max(100).optional(),
     lastName: z.string().max(100).optional(),
     pronouns: z.string().max(50).optional(),
     gender: z.string().max(50).optional(),
     headshotFileId: z.string().uuid().nullable().optional(),
     linkedinUrl: z.string().url().max(500).nullable().optional(),
     twitterUrl: z.string().url().max(500).nullable().optional(),
     facebookUrl: z.string().url().max(500).nullable().optional(),
     websiteUrl: z.string().url().max(500).nullable().optional(),
   }).partial();
   ```
   `.refine()` the bio field: plaintext code-point length (via `@/shared/lib/limits.ts` shared helper — the same rule the client counter uses) ≤ 5000. **Done when:** a unit test posts 5001 plaintext chars (with HTML tags padding it further) and gets a `VALIDATION` error both client- and server-side.

3. **`getSpeakerProfile(eventId, contactId)`.**
   - Reads the `contacts` row scoped `(id, event_id)`.
   - Returns the DTO with `headshotUrl` resolved to `/f/{headshotFileId}` (or `null`).
   - **Done when:** returns `null`-safe defaults for a freshly-created contact with every optional column empty (the seeded "missing bio/headshot" speakers exercise this).

4. **`updateProfile(eventId, contactId, patch)`.**
   - `sanitize(patch.bioHtml)` (M04's shared sanitizer, the narrow allowlist — not the wide resource-pages one) before persisting.
   - Calls `updateContactFields(db, eventId, contactId, {...only the keys present in patch})` — single-statement guarded update, no `withTx` needed (this is not one of the 8 audited transactional functions).
   - Returns the refreshed DTO.
   - **Done when:** PGlite test: patching only `{bioHtml}` leaves every other column untouched even when another concurrent write (simulated) changed `company` — proves field-scoped discipline (resolution #13 + edge case #5 "form write-back races").

5. **Profile page UI** (`app/(portal)/portal/[eventSlug]/profile/page.tsx`, mirrors the reference screenshots).
   - Header block: large avatar, name, email — read-only here.
   - Single tab "Profile Info", two collapsible `Card`s:
     - **General**: `<RichTextEditor>` for Biography with a live "`{n} / 5,000 characters`" counter (plaintext count, same helper as step 2's server refine — one counting rule, client and server never drift); Salutation, First Name, Last Name (text inputs); Honorific (text); Pronouns, Gender (`Select` — free-text-friendly, not a closed enum, per data-model `contacts.pronouns`/`gender` being plain `text`); headshot uploader (`<FileUpload kind="headshot">` — preview current avatar, replace flow calls `createUpload`→`finalizeUpload`→`updateProfile({headshotFileId})`, old file is simply de-referenced, not deleted — orphan cleanup handles it later per M07).
     - **My Links**: LinkedIn, X (Twitter), Facebook, Website — four URL inputs, empty string treated as `null` on submit.
   - React Hook Form + `zodResolver(profilePatchSchema)`; single explicit **Save** button (not autosave, matches the reference product) → `useMutation` → `PATCH /api/internal/portal/profile` → success toast "Saved successfully."
   - **Done when:** editing bio past 5,000 chars disables Save client-side with the counter turning red; a successful save shows the toast and the avatar updates without a full page reload; unicode/RTL text and emoji in the bio (matching the seed's hostile-string rows) render and count correctly.

6. **`PATCH /api/internal/portal/profile`.**
   - `defineHandler` (portal auth via `requirePortalContext`), input = `profilePatchSchema`, calls `updateProfile`.
   - **Done when:** `curl -X PATCH` with a valid portal session cookie and `{bioHtml:"<p>hi</p>"}` updates only that column (verified by a follow-up `GET`); posting a `<script>` in `bioHtml` stores it stripped (sanitizer proof).

## Acceptance criteria

Copied verbatim from the catalog (PLAN.md §4, M22), plus verification commands:

- Bio over 5,000 plaintext chars rejected both sides — `pnpm vitest run src/features/portal/profile/**/*.test.ts -t bio-limit` (server) + manual client-counter check.
- Headshot appears in gallery view after save — manual: save a headshot on the deployed preview, confirm it renders on `/e/[slug]/speakers` (M32) within the same request (no caching layer sits between `contacts` and the gallery's DB read; the gallery page itself may be s-maxage=60 cached, so allow up to 60s or hit it uncached in dev).
- Profile edit doesn't clobber concurrent form write-back fields — `pnpm vitest run src/features/portal/profile/**/*.test.ts -t field-scoped` (step 4's PGlite test).

## Guardrails

- **Resolution #13 is absolute:** this module never writes `UPDATE contacts SET ...` directly — every write goes through `updateContactFields`. CI's invariant grep bans raw `contacts` writes outside the owning helper; a direct write here fails the build.
- **Sanitize on save, not on render-only.** `bio_html` is rendered on the public gallery (M32) and in admin (M27) — it must be sanitized here at the write boundary (resolution #2), not trusted because "the editor only produces clean HTML."
- **Char-count rule must match the client counter exactly** — both sides call the same `@/shared/lib/limits.ts` helper (strip tags → count Unicode code points), never two independent implementations (R12).
- **Field-scoped writes only** (analysis edge case #5): a stale form-task write-back (M25) racing this page's Save must never revert to an older whole-row snapshot — `updateContactFields` only ever sets the columns present in the caller's patch object.
- **R10 nullable-render:** a freshly-admitted speaker with every profile column empty is a seeded state (missing bio/headshot filter) — the page must render sensible placeholders, not crash.
- **Headshot replace = new fileId** (M07's rule) — never re-use the old R2 key; just repoint `headshotFileId`.

## If blocked

If M07's `createUpload`/`finalizeUpload` aren't wired yet: build and ship the text/rich-text fields (steps 3–6 minus headshot) fully functional, with the headshot uploader rendering a disabled placeholder; wire it the moment M07 lands (same agent, same day, low risk). If genuinely idle, start M25's manual+file-mode task runtime (next in this agent's Sunday queue) — it shares the `<FileUpload>` wiring pattern this module establishes.
