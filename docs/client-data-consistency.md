# Client data consistency

TanStack Query is the authority for data that an interactive admin screen keeps
live in a shared client cache. React Server Components may perform the first
read, but they pass plain data under the exact feature-owned query keys to
`QueryBoundary`; they do not also pass a second `initialData` copy through the
component tree.

An RSC-owned screen does not need a client cache merely because it has forms or
dialogs. Its server props remain authoritative and a successful mutation either
refreshes that route or replaces one contained widget with the validated server
response. Contained response-local state is appropriate when no sibling reads
the same entity. If a second panel needs that state or background freshness is
introduced, migrate the shared read to a feature key instead of adding a second
owner.

## Ownership rules

1. Each feature owns a key factory. Queries, optimistic updates, direct cache
   writes, and invalidations import that factory; route-local key arrays are not
   allowed.
2. `QueryBoundary` creates one route-local client or reuses the nearest client
   for an embedded panel. A reusable child must not create an unconditional
   nested `QueryClientProvider`.
3. A mutation that returns the complete authoritative entity/list writes that
   exact cache entry. An optimistic mutation snapshots and rolls back on error,
   then invalidates the narrowest key on settle. A response that may be lost
   after commit invalidates on settle rather than assuming failure means no
   write occurred.
4. `router.refresh()` is reserved for navigation state or Server Component data
   that has no query representation. A mutation must not invalidate a query and
   refresh the route for the same data.
5. The shared default is a 15-second freshness window with focus refetch. A
   feature may document a different freshness budget on its query options.

## Enforced boundaries

`pnpm source:check` rejects production source that imports `QueryClient` or
`QueryClientProvider` outside the two shared owners, gives `useQuery` an
`initialData` copy, spells a query key as an array literal, or combines
`invalidateQueries()` with `router.refresh()` in one module. Tests may construct
isolated clients and literal keys as fixtures.

## Screen migration ledger

| Surface and routes | First paint | Live owner and freshness | Mutation and error policy |
|---|---|---|---|
| Event and organization lists, creation, home, and onboarding | RSC reads and redirect state | RSC/navigation; refreshed on the next transition | Server response or redirect commits progress; failed steps retain the submitted draft |
| Dashboard | RSC overview read hydrates `dashboardKeys.overview` | TanStack Query; 15-second stale window, 30-second polling, focus refetch | Read-only; a failed poll keeps the last good overview and exposes retry |
| Communications | RSC reads hydrate feature keys | TanStack Query with the shared freshness defaults | Complete responses write exact keys; optimistic edits roll back; logs invalidate only their prefix |
| Agenda | RSC reads hydrate sessions, accepted abstracts, and announcement keys | TanStack Query; conflicts derive from the live sessions key | Mutations invalidate only affected panels; drag/move rolls back; ambiguous commits refetch exact truth |
| Abstracts | RSC list, counts, vocabulary, and speaker options; detail drawer loads on demand | RSC props plus drawer-local request state; URL filters request a new server render | Successful decisions and edits refresh the RSC list/detail; forms and retry payloads survive errors |
| Evaluation and reviewer queue | RSC plans, assignments, members, invitations, and queue | RSC props; route/search-param navigation selects the active plan or review | Successful writes refresh server truth; rejected or ambiguous writes keep editor state and expose retry/recovery |
| CFP forms and task forms | RSC form snapshots | RSC props plus contained builder draft state | Validated responses patch the draft where possible; structural writes refresh the snapshot; failures retain unsaved input |
| Speakers, tasks, and files | RSC lists/counts; detail drawers fetch scoped detail | RSC props plus contained drawer/job state; filters are URL-owned | Successful writes patch the open widget or refresh the route; optimistic rows roll back and ambiguous jobs are polled/reloaded |
| Event settings, vocabulary, and API keys | RSC event/vocabulary/key reads | RSC props plus contained dialog state | Responses patch contained state or refresh the route; conflict/unknown outcomes reload authoritative vocabulary without discarding the attempted edit |
| Embeds and resource pages | RSC configuration/page seeds | Contained client-local collections; no sibling cache consumer | Validated responses replace rows; reorders roll back; failed saves keep drafts and offer retry/manual copy |
| Organization CRM directory, detail, pipeline, and segments | RSC filtered lists, metrics, histories, and pipeline | RSC props or one contained board collection; URL filters own list freshness | Responses reconcile the board/detail locally or refresh RSC truth; optimistic transitions/merges have rollback or an explicit reconciliation barrier |
| Organization team, audit, and billing | RSC members/invitations, audit entries, and billing summary | Team uses a contained response-local collection; audit/billing are RSC/read-only apart from checkout | Team writes patch or roll back exact rows and provide recovery reloads; checkout failures leave the current summary intact |

The route inventory has one owner per read: query-hydrated surfaces never keep a
parallel prop copy, and RSC/response-local surfaces do not create a TanStack
cache. Agenda mutation tests cover successful cross-panel freshness, optimistic
rollback, and ambiguous-response recovery; Communications tests cover exact key
ownership and editor rollback. The source guardrails prevent the ownership
patterns those tests exercise from drifting back into mixed refresh behavior.
