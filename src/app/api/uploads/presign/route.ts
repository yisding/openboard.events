import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { fileRequests } from "@/db/schema";
import { eventIdSchema, fileKindSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { UPLOAD_MAX_SIZE_MB, createUpload, type PolicyOverride } from "@/shared/server/r2";
import { assertMayUpload, deferredAuth, requireUploader } from "../_lib";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  eventId: eventIdSchema,
  kind: fileKindSchema,
  filename: z.string().min(1).max(400),
  mime: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  fileRequestId: z.uuid().optional(),
});

/** The owning file request is the only source of an upload policy override. */
async function requestPolicy(eventId: string, fileRequestId: string): Promise<PolicyOverride> {
  const [request] = await db
    .select({ extensions: fileRequests.acceptedExtensions, maxSizeMb: fileRequests.maxSizeMb })
    .from(fileRequests)
    .where(and(eq(fileRequests.id, fileRequestId), eq(fileRequests.eventId, eventId)))
    .limit(1);
  if (!request) throw new AppError("NOT_FOUND", "File request not found");
  return { extensions: request.extensions, maxSizeMb: Math.min(request.maxSizeMb, UPLOAD_MAX_SIZE_MB) };
}

const presign = defineHandler({
  auth: deferredAuth,
  input: inputSchema,
  handler: async ({ input, req }) => {
    const uploader = await requireUploader(req, input.eventId);
    assertMayUpload(input.kind, uploader);

    if (input.kind === "upload" && !input.fileRequestId) {
      throw new AppError("VALIDATION", "fileRequestId is required for a file-request upload");
    }
    if (input.fileRequestId && input.kind !== "upload") {
      throw new AppError("VALIDATION", "fileRequestId only applies to kind=upload");
    }
    const policyOverride = input.fileRequestId ? await requestPolicy(input.eventId, input.fileRequestId) : undefined;

    return createUpload({
      eventId: input.eventId,
      kind: input.kind,
      filename: input.filename,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      ...(policyOverride ? { policyOverride } : {}),
      ...(uploader.kind === "admin" ? { uploadedByUserId: uploader.userId } : { uploadedByContactId: uploader.contactId }),
    });
  },
});

// defineHandler takes an optional route context; a static route's exported handler
// must not, so the export narrows it to the request alone.
export const POST = (request: NextRequest) => presign(request);
