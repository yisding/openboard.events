import { withTx } from "@/db/client";
import {
  listFailedAdminAuthEmailsIn,
  requeueFailedAdminAuthEmailsIn,
  type AuthOutboxRequeueRow,
} from "@/features/auth";

/**
 * Operator remedy for `admin_auth_email_outbox` rows that exhausted the shared
 * six-attempt cutoff (issue #625).
 *
 * That table carries password resets, email verification, and organization
 * invitations, and until this existed a terminal failure was final: nothing in
 * the product could re-open a `failed` row, so a provider outage or a briefly
 * wrong `RESEND_API_KEY` locked every affected admin out of password recovery
 * with SQL as the only way back.
 *
 * Reporting is the default and writing is opt-in. This command re-sends real
 * mail to real people, and the first thing an operator mid-incident needs is to
 * see the blast radius — how many, to whom, and what they died of — before
 * deciding. `--apply` is the second step, not the first.
 *
 *   pnpm auth:requeue                          # report every failed row
 *   pnpm auth:requeue -- --email a@b.com       # narrow to one recipient
 *   pnpm auth:requeue -- --id <uuid> --apply   # re-open one row
 *   pnpm auth:requeue -- --apply               # re-open all of them
 *
 * Requires `DATABASE_URL`. The rows go back to `queued` with `next_attempt_at`
 * now, so the every-minute drain picks them up without a deploy.
 */

type Options = { emails: string[]; ids: string[]; apply: boolean };

function parseArgs(argv: string[]): Options {
  const options: Options = { emails: [], ids: [], apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--email") options.emails.push(required(argv[++index], "--email"));
    else if (arg === "--id") options.ids.push(required(argv[++index], "--id"));
    else throw new Error(`Unrecognized argument: ${arg}`);
  }
  return options;
}

function required(value: string | undefined, flag: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${flag} needs a value`);
  return trimmed;
}

function describe(row: AuthOutboxRequeueRow): string {
  const age = Math.round((Date.now() - row.createdAt.getTime()) / 60_000);
  return `  ${row.id}  ${row.templateKey.padEnd(26)} ${row.recipientEmail.padEnd(32)} ${age}m old, ${row.attempts} attempts — ${row.error ?? "no recorded error"}`;
}

// tsx transforms this to CJS, where top-level await is unavailable, so the run
// lives in main(). Without it the script dies in esbuild before doing anything.
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  await withTx(async (tx) => {
    if (!options.apply) {
      // The same selection the requeue would act on, not a lookalike — a
      // preview that shows a different set than the command it previews is
      // worse than no preview.
      const rows = await listFailedAdminAuthEmailsIn(tx, { ids: options.ids, emails: options.emails });
      if (rows.length === 0) {
        console.log("No failed admin auth emails match that filter.");
        return;
      }
      console.log(`${rows.length} failed admin auth email(s):`);
      for (const row of rows) console.log(describe(row));
      console.log("\nRe-send them with the same filter plus --apply.");
      return;
    }

    const result = await requeueFailedAdminAuthEmailsIn(tx, { ids: options.ids, emails: options.emails });
    console.log(`Requeued ${result.requeued.length} admin auth email(s):`);
    for (const row of result.requeued) console.log(describe(row));
    if (result.unrecoverable.length > 0) {
      // The link *is* the message for every template here, so a row whose
      // sealed payload is gone would deliver mail that cannot do anything.
      console.log(`\n${result.unrecoverable.length} row(s) cannot be re-sent — their sealed link payload is gone.`);
      for (const row of result.unrecoverable) console.log(describe(row));
      console.log("Ask those recipients to request a fresh reset or verification instead.");
    }
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
