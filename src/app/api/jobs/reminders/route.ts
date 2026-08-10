import { scanReminders } from "@/features/comms";
import { defineJobRoute } from "../_lib";

export const dynamic = "force-dynamic";

// Gate (PLAN delta #20): this route carried M08's stub until the PGlite AC
// suite in src/features/comms/reminders.test.ts went green. It is green, so
// the real burst-safe scan now runs on every %15 tick.
//
// The gate's SECOND precondition — a reset preview seed whose first wired tick
// produces exactly one queued row and two skipped rows for the seeded overdue
// task — is a property of the SEED, not of this route. It holds only if the
// seed backdates both halves of `materialized_at`:
//   · portal_tasks.created_at for the confirm-details task (scripts/seed/portal.ts)
//   · the accepted rows' submitted_at/decided_at, which the status trigger
//     otherwise stamps as now() (scripts/seed/submissions.ts, M17-owned)
// `reminders.test.ts`'s "BOTH backdates are load-bearing" case pins all four
// combinations. Before CP3 sign-off, run the row-count check explicitly — not
// a log-shape glance — on a freshly reset preview:
//
//   psql $SB_DEV -c "select status, count(*) from communication_logs \
//     where template_key='task_reminder' group by 1"   -- expect queued 1, skipped 2
//   curl -XPOST …/api/jobs/reminders                    -- second tick adds zero rows
//
// Failure mode if a backdate is missing: the tick sends nothing and retires all
// three rungs permanently (skipped rows own their keys forever), so the fixture
// must be corrected BEFORE the first live tick, or re-seeded from scratch after.
export const { POST } = defineJobRoute("reminders", () => scanReminders());
