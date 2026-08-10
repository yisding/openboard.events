# Neon PITR rehearsal runbook

[`backup-restore.md`](./backup-restore.md) documents *how* to restore Neon from a point in time.
This document is the drill that proves those commands still work — the same relationship
`rollback.md`'s "rehearsed against production at least once" checklist item has to an actual
rollback, applied to the database side instead of the Worker-code side (see
`docs/submission-checklist.md`, "The deployment"). A restore procedure nobody has actually run
since it was written is a procedure you're debugging for the first time during an incident,
against production, under time pressure. This is how that first run happens somewhere safer.

## Ground rule: never rehearse against `sb-test` or `sb-prod`

Every command below targets **`sb-dev`** — the Neon branch `docs/provisioning.md` §1 already maps
to local/development use, and disposable by design. `sb-test` backs the deployed preview and
`sb-prod` backs production; a rehearsal branch created off either, or an in-place restore run
against either, leaves the environment in a state someone else didn't expect. If a real incident
ever needs this procedure run against `sb-test`/`sb-prod` for real, that's `backup-restore.md`
itself, not this file — this file's job ends at "the commands work," not "prove them on the
databases other people are using."

## Cadence

Run both exercises below:

- Before any release that ships a migration touching a high-value table (`submissions`,
  `contacts`, `communication_logs`) — a restore rehearsed against last quarter's schema is not the
  same drill as one against this week's.
- At minimum quarterly regardless, so the gap between drills never exceeds what
  `docs/provisioning.md`'s own secret-rotation cadence assumes.
- Once, before the *first* time this procedure is ever needed for real — if that hasn't happened
  yet, do it now rather than waiting for an incident to be the first rehearsal.

## Prerequisites

Same as `backup-restore.md`: `NEON_API_KEY` (or a prior `neonctl auth`) and the project's
`--project-id` (`neonctl projects list`). Confirm which branch is actually `sb-dev` before typing
anything else — `neonctl branches list --project-id <id>` — since a rehearsal's entire safety
argument rests on targeting the disposable branch, not a stale mental model of which branch that
is.

## Exercise A — branch-first restore (the default-choice path)

Rehearses `backup-restore.md` §§1–2 end to end, including the cutover step, without ever actually
cutting the running app over.

1. **Seed a marker.** A dedicated throwaway table, not a row in a real application table —
   `events`, `submissions`, etc. all carry required columns and constraints that drift as the
   schema evolves, and this drill has no business depending on that shape staying still. Create
   the table once (idempotent — safe to re-run on a later rehearsal) with a beat of separation
   before the row that actually gets time-traveled past:

   ```bash
   psql "$(neonctl connection-string sb-dev --project-id <id> --pooled)" \
     -c "create table if not exists pitr_drill_marker (created_at timestamptz not null default now());"
   ```

   Wait a few seconds so the table's own creation is unambiguously before the marker row, then:

   ```bash
   psql "$(neonctl connection-string sb-dev --project-id <id> --pooled)" \
     -c "insert into pitr_drill_marker default values;"
   ```

   Record the exact wall-clock time this insert ran.

2. **Wait past it, then time-travel query from before it existed** — `backup-restore.md` §1,
   verbatim:

   ```bash
   neonctl connection-string sb-dev@<timestamp-before-the-insert> --project-id <id> --pooled
   ```

   ```bash
   psql "<that connection string>" \
     -c "select count(*) from pitr_drill_marker;"
   ```

   **Expected: `0`.** If it's `1`, the timestamp picked is not actually before the insert — pick
   an earlier one and retry before continuing; a rehearsal that "passes" on a wrong timestamp
   teaches nothing. (If the query instead errors with "relation does not exist," the timestamp is
   before the `create table` step too — pick one between the two commands above.)

3. **Branch from that point** — `backup-restore.md` §2:

   ```bash
   neonctl branches create --project-id <id> \
     --parent "sb-dev@<timestamp-before-the-insert>" \
     --name pitr-drill-$(date +%Y%m%d)
   ```

4. **Verify the branch** — connect and confirm the marker is genuinely absent, then confirm
   `pnpm db:migrate` is a clean no-op against it (proving the branch's schema is current, not
   stuck behind a migration the restore point predates):

   ```bash
   export DATABASE_URL_DIRECT="$(neonctl connection-string pitr-drill-$(date +%Y%m%d) --project-id <id>)"
   pnpm db:migrate
   ```

5. **Clean up.** This is the step real incidents sometimes skip under pressure — a rehearsal is
   exactly where to build the habit:

   ```bash
   neonctl branches delete pitr-drill-$(date +%Y%m%d) --project-id <id>
   ```

## Exercise B — in-place restore with `--preserve-under-name` (the higher-risk path)

`backup-restore.md` §3 is the path used when you're already certain and want the fix applied in
place rather than cut over separately. It's higher-risk precisely because it mutates the branch
in place, which is exactly why it deserves its own rehearsal rather than assuming Exercise A
covers it — `--preserve-under-name` is untested by Exercise A entirely.

1. Repeat step 1 from Exercise A against `sb-dev` (a fresh marker row, fresh timestamp) unless
   Exercise A just ran and its marker is still gone.

2. **Restore `sb-dev` in place**, preserving its pre-restore state under a recognizable name:

   ```bash
   neonctl branches restore sb-dev "^self@<timestamp-before-the-insert>" \
     --project-id <id> \
     --preserve-under-name pitr-drill-preserve-$(date +%Y%m%d)
   ```

3. **Verify `sb-dev` itself now lacks the marker**, and that local/dev work against it still
   functions — `pnpm db:migrate` against `sb-dev`'s direct URL, then whatever smoke you'd normally
   run locally:

   ```bash
   psql "$(neonctl connection-string sb-dev --project-id <id> --pooled)" \
     -c "select count(*) from pitr_drill_marker;"
   # expect 0
   ```

4. **Prove the restore is itself reversible** — this is the step that actually validates
   `--preserve-under-name`, not just the restore: restore `sb-dev` again, this time from the
   preserved branch, to undo the drill and leave `sb-dev` exactly as it was before step 2 (marker
   included):

   ```bash
   neonctl branches restore sb-dev "pitr-drill-preserve-$(date +%Y%m%d)" --project-id <id>
   psql "$(neonctl connection-string sb-dev --project-id <id> --pooled)" \
     -c "select count(*) from pitr_drill_marker;"
   # expect 1 — the undo worked
   ```

5. **Clean up** the preserved branch once step 4 confirms it's no longer needed:

   ```bash
   neonctl branches delete "pitr-drill-preserve-$(date +%Y%m%d)" --project-id <id>
   ```

6. Truncate the marker table so `sb-dev` doesn't accumulate drill debris (leave the table itself —
   `create table if not exists` in step 1 of the next rehearsal makes re-running this file
   idempotent either way):

   ```bash
   psql "$(neonctl connection-string sb-dev --project-id <id> --pooled)" \
     -c "truncate pitr_drill_marker;"
   ```

## Record the rehearsal

Append an entry to `DECISIONS.md` (repo root, not under `plan/`) after each run, in the style of
its existing dated findings — date, who ran it, both exercises' pass/fail, wall-clock time for
each step, and — the actually valuable part — anything that didn't match this file exactly (a
`neonctl` flag renamed, a timing assumption that no longer held, retention window shorter than
expected). A rehearsal that reveals the runbook is stale and gets **fixed in the same change** is
the entire point; one that's just noted and left for next time defeats it.

## If a rehearsal fails

Stop and fix `backup-restore.md` (or this file, if the drill procedure itself is what's wrong)
before considering the rehearsal complete — do not mark the cadence checkbox and move on. A
restore runbook is only as trustworthy as its last successful rehearsal, not its last edit.

## See also

- [`backup-restore.md`](./backup-restore.md) — the procedure this rehearses, including its "R2
  file objects" section's cleanup-cron interaction note, which matters most right after any
  restore, drill or real (a rehearsal against disposable `sb-dev` can skip that reconciliation
  step; a real restore against `sb-test`/`sb-prod` cannot).
- [`rollback.md`](./rollback.md) — the Worker-code counterpart; its own "rehearsed against
  production at least once" checklist item is the pattern this file follows for the database side.
- [`alerting.md`](./alerting.md) — `/api/health`'s `db.ok` field is what a real incident would
  actually alert on before anyone reaches for this runbook.
- [`r2-lifecycle.md`](./r2-lifecycle.md) — the storage-side rehearsal-adjacent concern: R2's own
  orphan-object hygiene, provisioned and rehearsed the same way this file rehearses Neon's.
