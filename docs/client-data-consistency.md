# Client data consistency

TanStack Query is the authority for data that an interactive admin screen reads
after hydration. React Server Components may perform the first read, but they
pass plain data under the exact feature-owned query keys to `QueryBoundary`;
they do not also pass a second `initialData` copy through the component tree.

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

## Screen migration ledger

| Surface | First paint | Live owner | Mutation policy | Status |
|---|---|---|---|---|
| Communications | Server reads hydrate feature keys | TanStack Query | Exact write, rollback, or log-prefix invalidation | Migrated |
| Agenda | Server reads seed sessions, accepted abstracts, and announcement keys | TanStack Query; conflicts derive from cached sessions | Exact cross-panel invalidation, optimistic move rollback | Migrated |
| Dashboard | Server read hydrates the overview key | TanStack Query with 30-second polling | Read-only | Migrated |
| Forms, CRM, evaluation, speakers, tasks | Server Components/props | Route refresh and local state | Feature-specific | Pending inventory/migration |

The ledger is updated in each feature migration. The workstream is complete only
when every interactive admin surface names one first-paint owner, one live owner,
and an error/rollback policy.
