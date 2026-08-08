# M05a — Admin shell + core list primitives

| | |
|---|---|
| **Status** | NOT STARTED |
| **Workstream / executing agent** | WS-A Platform & Foundation (architect) |
| **Scheduled** | Sat AM — gates CP1 (Sat noon) |
| **Size** | M |
| **Paths owned** | `src/shared/ui/**` (shadcn-generated primitives + the **core** app set: `app/data-table.tsx`, `app/status-badge.tsx`, `app/empty-state.tsx`, `app/confirm-dialog.tsx`, `app/dash.tsx`, `app/tz-time.tsx`, `app/color-chip.tsx`, `app/page-header.tsx`), `src/app/(admin)/layout.tsx`, `src/app/(admin)/events/[eventId]/layout.tsx`, `src/app/(admin)/error.tsx`, `src/app/kitchen-sink/page.tsx`. **NOT owned:** the rich set (`rich-text-editor`, `rich-text-view`, `datetime-picker`, `file-upload`, `stat-tile`, `donut`) → [M05b](./M05b-rich-ui-primitives.md) |

## Objective
The admin chrome exists — sidebar with event switcher and the full nav tree, topbar with View Portal and user menu — and every list-heavy module can start immediately against one shared `<DataTable>`, `<StatusBadge>`, `<EmptyState>`, `<ConfirmDialog>`, `<Dash>` and `<TzTime>`. This is the Sat-AM unblocking half of the old M05: it deliberately ships **without** the editor/picker/upload primitives so nine downstream modules are not queued behind TipTap and R2.

## Dependencies
- **Hard (blocks start):** [M01](./M01-scaffold-ci-deploy.md) (Tailwind + shadcn config + `@/*` alias), [M04](./M04-shared-libs.md) (`formatInZone` for `<TzTime>`, `cn`).
- **Soft (start against stub/fixture):**
  - `<EventSwitcher>` and `getEvent`/`getEventBySlug` come from [M11](./M11-events-feature.md); build the layout against the **Phase-0 throwing stubs** in `@/features/events` and its own `src/features/events/fixtures.ts` fixture event (M11-owned, created in its Step 1 — **not** a file in M02's frozen `src/shared/fixtures/*.ts` set). Swap is zero-code: the layout already imports the barrel.
  - `requireAdmin` comes from [M06a](./M06a-admin-auth.md), landing the same morning. Until it does, the layout calls the stub inside a `try/catch` that renders the shell with a "not signed in" topbar; delete the catch when [M06a](./M06a-admin-auth.md) merges.
  - Every nav destination is a stub page created by its owning workstream; the shell must render correctly with 404-less stubs (CP1 requires "every route renders a stub page").

## Provides (interfaces others consume)
- `@/shared/ui/app/data-table` — **`<DataTable<T>>`**, consumed by [M11](./M11-events-feature.md), [M12](./M12-form-builder-core.md), [M17](./M17-abstracts-table.md), [M19](./M19-evaluation-scoring.md), [M21](./M21-portal-shell.md), [M23](./M23-tasks-admin.md), [M27](./M27-speakers-admin.md), [M28](./M28-sessions-crud.md), [M37](./M37-comms-admin-ui.md), [M38](./M38-dashboard.md).
- `@/shared/ui/app/status-badge` — **`<StatusBadge kind status>`** for `SubmissionStatus`, `SessionStatus`, `CommStatus`, `FormStatus`, `ConfirmationStatus`, task state. Colors live **beside the enum**, one map, no per-feature copies.
- `@/shared/ui/app/empty-state` — **`<EmptyState icon title hint action?>`**; the screenshots show 10+ designed empty states, this is the cheap parity win.
- `@/shared/ui/app/confirm-dialog`, `app/dash` (**`<Dash value>` = `value ?? '—'`**, R10), `app/tz-time` (**`<TzTime instant tz style>`**), `app/color-chip`, `app/page-header`.
- `(admin)` layout slots: sidebar nav, topbar actions, `<PageHeader title subtitle actions>` — every admin page renders inside these.
- shadcn primitives generated into `src/shared/ui/`: button, input, textarea, label, select, checkbox, switch, tabs, dialog, sheet, drawer, dropdown-menu, popover, tooltip, badge, card, separator, skeleton, sonner (toast), table, form, avatar, scroll-area, command *(command only if free — ⌘K is cut-line #4)*.

## Step-by-step implementation

### 1. CONTRACT-FIRST SLICE — export the primitives' prop types first (first 30 minutes)
Files: all seven `src/shared/ui/app/*.tsx` with real prop types and a placeholder render (`<div>`/plain `<table>`). Push immediately — [M17](./M17-abstracts-table.md) and [M11](./M11-events-feature.md) start Sat AM and only need the types to be stable.
```ts
export type DataTableProps<T> = {
  columns: ColumnDef<T, unknown>[]; data: T[];
  isLoading?: boolean; empty: React.ReactNode;
  enableSelection?: boolean; onSelectionChange?: (rows: T[]) => void;
  columnVisibilityKey?: string;              // localStorage key; cut-line #4 caps it here
  onRowClick?: (row: T) => void;
  toolbar?: React.ReactNode; pageSize?: number;
};
```
- **Done when:** `pnpm typecheck` green and another module can import every primitive by name.

### 2. shadcn generation + theme
`pnpm dlx shadcn@latest init` with `components.json` aliases `ui → @/shared/ui`, `utils → @/shared/lib/cn`. Generate the list above. **Generated files are never edited** — customization happens in `shared/ui/app/*` wrappers so regeneration stays safe and all agents share one look.
Theming: default shadcn theme + one accent CSS variable per event (from event branding) applied on public/portal/embed layouts. **Light mode only** (dark-mode QA is cut).
- **Done when:** `src/app/kitchen-sink/page.tsx` renders a button, a dialog, a tabs strip and a toast without console errors.

### 3. `<DataTable>` on TanStack Table v8
Sorting, column filters, pagination (client-side; seed volumes are ~25 rows), row selection (**page-local**, matching [M17](./M17-abstracts-table.md)'s bulk-select semantics), column visibility persisted to `localStorage` under `columnVisibilityKey`, a `toolbar` slot for search/filters, a skeleton state on `isLoading`, and the `empty` node rendered when `data.length === 0` **after** loading.
Edge cases to build in now, because six modules would each hit them:
- a row leaving the active filter must not break the pager (clamp `pageIndex` when `pageCount` shrinks) — [M17](./M17-abstracts-table.md)'s AC depends on this;
- `undefined`/`null` cell values render via `<Dash>`, never `String(undefined)`;
- sorting a column with nulls puts **"—" last** in both directions (the Rating column, [M19](./M19-evaluation-scoring.md)).
- **Done when:** the kitchen sink shows a 3-column table over a 25-row fixture with sort, filter, select-all-on-page, column hide (persisting across reload), and an empty state when the filter matches nothing.

Canonical call-site shape every consumer copies (put it in the file's doc comment so nobody invents a second style):
```tsx
<DataTable
  columns={cols}                    // ColumnDef<SubmissionListRow>[] defined in the feature
  data={rows}
  isLoading={query.isPending}
  empty={<EmptyState icon={Inbox} title="No abstracts yet"
           hint="Submissions appear here as speakers complete the CFP form."
           action={<Button onClick={openAdd}>Add Abstract</Button>} />}
  enableSelection
  onSelectionChange={setSelected}
  columnVisibilityKey={`abstracts:${eventId}`}
  onRowClick={(r) => openDrawer(r.id)}
  toolbar={<SearchInput … />}
/>
```

### 4. `<StatusBadge>` — colors beside the enum
One `Record<SubmissionStatus, {label, className}>` next to the import of `SUBMISSION_STATUSES`, with `assertNever` exhaustiveness so adding a status breaks the build here (R5). Proposed palette: `draft` slate · `pending` amber · `accept_queue` sky · `decline_queue` orange · `accepted` green · `declined` red · `withdrawn` zinc-outline. Same pattern for `SessionStatus` (draft/published), `CommStatus` (queued/sent/failed/skipped), `FormStatus`, `ConfirmationStatus`, and task state (open/completed/overdue).
**Portal never shows queue states** — the portal passes `PORTAL_STATUS_LABEL` from [M02](./M02-shared-contracts.md), which maps `accept_queue`/`decline_queue` → "Pending". Document that on the component.
- **Done when:** the kitchen sink renders all 7 submission statuses and removing one from the const array fails `tsc`.

### 5. `(admin)` layout — sidebar + topbar
`src/app/(admin)/layout.tsx` (chrome) and `src/app/(admin)/events/[eventId]/layout.tsx` (event-scoped chrome + `requireAdmin(eventId)` gate).
Sidebar, top to bottom (derived from the real product's nav in the analyses, trimmed to what we build):
- **Event switcher card** — avatar initials, truncated event name, date range rendered `formatInZone(startsAt) – formatInZone(endsAt)` ("Oct 12–14, 2026"), chevron → `<EventSwitcher>` from [M11](./M11-events-feature.md).
- **Dashboard** → `/events/[eventId]/dashboard`
- **PROGRAM**: Abstracts → `/submissions` · Forms → `/forms` · Evaluation → `/evaluation` · Agenda → `/agenda`
- **PORTAL**: Speakers → `/speakers` · Tasks → `/tasks` · Resources → `/resources`
- **Comms** → `/comms` · **Embeds** → `/embeds` · **Settings** → `/settings`
Active item is highlighted from `usePathname()`. Topbar: event name breadcrumb, **View Portal** button (→ `/portal/[eventSlug]`), user menu (avatar, email, Sign out).
**Skipped deliberately** (never build): "Find or ask" ⌘K palette (cut-line #4), announcements megaphone, help icon, CRM/Marketing/CMS/Invoices/Site/Personas/Record Settings nav items.
- **Done when:** clicking every nav item navigates to a stub page with the sidebar highlight following, and the shell renders at 1280px and 1024px without horizontal scroll.

**Conventions this module publishes and every consumer follows** (write them into the file headers — they are the reason six agents produce one product rather than six):
1. Every list surface uses `<DataTable>`; building a second table component is a review-blocker.
2. `empty` is a **required** prop — there is no undesigned empty state in the product.
3. Nullable cells render `<Dash value={x} />`, never `{x}` or `{x ?? '-'}` inline.
4. Times render `<TzTime instant={x} tz={event.timezone} />`, never a local `toLocaleString()`.
5. Destructive actions go through `<ConfirmDialog>`; `409` responses use its `stale` variant.
6. Status pills come from `<StatusBadge>`; a feature-local color map is drift by definition.
7. Page chrome is `<PageHeader title subtitle actions>` inside the `(admin)` layout — pages never render their own `<h1>` + button row.

### 6. `(admin)/error.tsx` + not-found
Tone-appropriate copy, the error digest, and a "try again" button (R6/§6 of quality-strategy). `notFound()` on a bad `eventId` renders a branded 404, not a crash.

### 7. Kitchen sink page
`src/app/kitchen-sink/page.tsx` renders every core primitive with fixture data, including: a table with hostile strings (`;lkj`, a 255-char title, RTL text, emoji), an all-nulls row, all `StatusBadge` variants, three `EmptyState`s, a `ConfirmDialog`, and `<TzTime>` for the same instant in two zones. This page is the eyeball gate every agent uses before shipping a list surface.
[M05b](./M05b-rich-ui-primitives.md) extends it at a **separate route** (`/kitchen-sink/rich`) so the two modules never edit the same file.

## Acceptance criteria
Catalog AC, verbatim: *kitchen-sink page renders the core primitives; admin shell navigates between stub pages; light-mode only.*

```bash
pnpm dev  # then:
open http://localhost:3000/kitchen-sink                  # all core primitives, hostile row renders safely
open http://localhost:3000/events/<seedEventId>/dashboard # sidebar highlights; every nav item navigates
pnpm typecheck && pnpm lint                              # exhaustive switches, no any
pnpm exec playwright test e2e/admin-setup.spec.ts        # (later, M10) shell must be stable for this spec
```

## Guardrails
- **Building a duplicate table/badge/empty-state in a feature folder is a review-blocker.** Nine modules consume these; a second `<DataTable>` is how a hackathon UI stops looking like one product.
- **R10 nullable-render rule:** table cells and detail rows never interpolate a nullable without `<Dash>`. The seed contains a row that is null in **every** nullable column — if a surface crashes on it, the eyeball pass fails immediately.
- **No `dangerouslySetInnerHTML` here.** Rich text renders only through [M05b](./M05b-rich-ui-primitives.md)'s `<RichTextView>`, the single site in the repo (grep #1). If a list cell needs a description, render `plainTextLength`-truncated **text**, not HTML.
- **Timezone:** `<TzTime>` takes the event tz explicitly and calls `formatInZone`, which always appends the label. There is no un-labeled time rendering in admin.
- **Empty states are a deliverable, not a nicety** — the seeded empty second event is a standing test and the analyses count 10+ designed empty states in the real product. Every `<DataTable>` call site must pass `empty`; make the prop required.
- **Zustand only for ephemeral UI state** (litmus: "if the server could need it, it's not Zustand state"). Table filter/column prefs → localStorage; row data → TanStack Query. Never mirror query data into a store.
- **Light mode only.** Do not add a dark-mode toggle; dark-mode QA is explicitly cut.
- Concurrent-edit edge case: `<ConfirmDialog>` is also the 409 surface — give it a variant that renders "changed since you loaded — refresh" so every module's `STALE_WRITE` path has a designed state on day one.

## If blocked
- **shadcn CLI failing:** hand-copy the four primitives the shell needs (button, dropdown-menu, tabs, dialog) from the registry into `src/shared/ui/` and keep going; the CLI is a convenience, not a dependency.
- **[M11](./M11-events-feature.md)'s `<EventSwitcher>` still a stub:** render a static event-name card from the fixture. The layout must not block on it.
- **[M06a](./M06a-admin-auth.md) not merged:** ship the shell ungated behind a `TEST_AUTH=1` bypass and let [M06a](./M06a-admin-auth.md) drop the gate in — CP1 needs the shell to render, not to be locked.
- **Done early:** extend the kitchen sink with the hostile-string row set and write the `<DataTable>` usage snippet into `DECISIONS.md`; then start [M06a](./M06a-admin-auth.md), which is the other CP1 gate.
