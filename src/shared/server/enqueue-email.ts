import type { ContactId, EventId, SessionId, SubmissionId, TaskId, TemplateKey } from "@/shared/contracts";
import type { DbOrTx } from "@/db/client";
import { communicationLogs } from "@/db/schema";
import { AppError } from "@/shared/lib/errors";

/**
 * The template keys whose outbox row carries a sealed, one-shot credential —
 * and the exact set the `communication_logs` CHECK constraint allows a
 * `secret_payload_ciphertext` on (drizzle/0000_init.sql, widened by
 * drizzle/0009_product_auth.sql, narrowed by accident in 0011 and restored in
 * 0044). Every one of these is a credential the recipient asked for seconds
 * earlier and that the dispatcher clears the moment it has rendered it.
 *
 * Exported for `tests/integration/secret-payload-contract.test.ts`, which
 * applies the migration journal and checks the database agrees key for key.
 * The two definitions drifted silently once; the point of the export is that
 * they cannot again.
 */
export const SECRET_PAYLOAD_TEMPLATE_KEYS: ReadonlySet<TemplateKey> = new Set<TemplateKey>([
  "portal_login",
  // M42 — Better Auth's admin password-reset and email-verification links.
  "admin_password_reset",
  "admin_email_verification",
]);

export async function enqueueEmail(dbOrTx: DbOrTx, args: {
  eventId: EventId;
  templateKey: TemplateKey;
  contactId: ContactId;
  idempotencyKey: string;
  refs?: { submissionId?: SubmissionId; sessionId?: SessionId; taskId?: TaskId };
  secretPayloadCiphertext?: Uint8Array;
}): Promise<void> {
  const carriesSecret = SECRET_PAYLOAD_TEMPLATE_KEYS.has(args.templateKey);
  if (carriesSecret !== (args.secretPayloadCiphertext !== undefined)) {
    throw new AppError("VALIDATION", carriesSecret
      ? `${args.templateKey} requires encrypted delivery payload`
      : `encrypted delivery payload is restricted to ${[...SECRET_PAYLOAD_TEMPLATE_KEYS].join(", ")}`);
  }
  await dbOrTx.insert(communicationLogs).values({
    eventId: args.eventId,
    templateKey: args.templateKey,
    contactId: args.contactId,
    idempotencyKey: args.idempotencyKey,
    status: "queued",
    ...(args.refs?.submissionId ? { submissionId: args.refs.submissionId } : {}),
    ...(args.refs?.sessionId ? { sessionId: args.refs.sessionId } : {}),
    ...(args.refs?.taskId ? { taskId: args.refs.taskId } : {}),
    ...(args.secretPayloadCiphertext ? { secretPayloadCiphertext: args.secretPayloadCiphertext } : {}),
  }).onConflictDoNothing({ target: communicationLogs.idempotencyKey });
}
