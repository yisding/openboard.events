import type { NextRequest } from "next/server";
import { z } from "zod";
import { fileIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { describeFile, finalizeUpload } from "@/shared/server/r2";
import { assertMayFinalize, deferredAuth, requireUploader } from "../_lib";

export const dynamic = "force-dynamic";

const finalize = defineHandler({
  auth: deferredAuth,
  input: z.object({ fileId: fileIdSchema }),
  handler: async ({ input, req }) => {
    const file = await describeFile(input.fileId);
    if (!file) throw new AppError("NOT_FOUND", "Upload not found");
    const uploader = await requireUploader(req, file.eventId);
    assertMayFinalize(file, uploader);
    // Rejection deletes the object and the row, so a caller may only store the
    // fileId in an owning column once this returns ready.
    return finalizeUpload(input.fileId);
  },
});

// defineHandler takes an optional route context; a static route's exported handler
// must not, so the export narrows it to the request alone.
export const POST = (request: NextRequest) => finalize(request);
