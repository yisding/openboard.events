import type { NextRequest } from "next/server";
import { z } from "zod";
import { fileIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { finalizeUpload } from "@/shared/server/r2";
import { assertMayFinalize, deferredAuth, requireFileUploader } from "../_lib";

export const dynamic = "force-dynamic";

const finalize = defineHandler({
  auth: deferredAuth,
  input: z.object({ fileId: fileIdSchema }),
  handler: async ({ input, req }) => {
    // An unknown fileId and a real upload the caller does not own answer the
    // same way, so finalize cannot be used to probe which ids exist either.
    const { file, uploader } = await requireFileUploader(req, input.fileId);
    assertMayFinalize(file, uploader);
    // Rejection deletes the object and the row, so a caller may only store the
    // fileId in an owning column once this returns ready.
    return finalizeUpload(input.fileId);
  },
});

// defineHandler takes an optional route context; a static route's exported handler
// must not, so the export narrows it to the request alone.
export const POST = (request: NextRequest) => finalize(request);
