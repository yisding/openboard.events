import type { ContactId, EventId, SessionId, SubmissionId, TaskId, TemplateKey } from "@/shared/contracts";
import type { TxDb } from "@/db/client";
import { communicationLogs } from "@/db/schema";
import { AppError } from "@/shared/lib/errors";

export async function enqueueEmail(tx: TxDb, args: {
  eventId: EventId;
  templateKey: TemplateKey;
  contactId: ContactId;
  idempotencyKey: string;
  refs?: { submissionId?: SubmissionId; sessionId?: SessionId; taskId?: TaskId };
  secretPayloadCiphertext?: Uint8Array;
}): Promise<void> {
  const isLogin = args.templateKey === "portal_login";
  if (isLogin !== (args.secretPayloadCiphertext !== undefined)) {
    throw new AppError("VALIDATION", isLogin ? "portal_login requires encrypted delivery payload" : "encrypted delivery payload is restricted to portal_login");
  }
  await tx.insert(communicationLogs).values({
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
