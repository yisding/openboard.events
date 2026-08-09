import type { NextRequest } from "next/server";
import { fileIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { asRequester, jsonRoute, requireUploader } from "../../_lib";
import { describeFile, getDownloadUrl } from "@/shared/server/r2";

export const dynamic = "force-dynamic";

const DOWNLOAD_URL_SECONDS = 60 * 60;

/** Private kinds never serve through /f/{fileId}; this mints the short-lived GET. */
export async function GET(request: NextRequest, route: { params: Promise<{ fileId: string }> }): Promise<Response> {
  return jsonRoute(request, async () => {
    const rawFileId = (await route.params).fileId;
    const parsedFileId = fileIdSchema.safeParse(rawFileId);
    if (!parsedFileId.success) throw new AppError("VALIDATION", "Invalid file id");
    const fileId = parsedFileId.data;
    const file = await describeFile(fileId);
    if (!file) throw new AppError("NOT_FOUND", "File not found");
    const uploader = await requireUploader(request, file.eventId);
    // getDownloadUrl re-checks (eventId, fileId, requester) together; passing the
    // event from the row is what keeps one event's session out of another's files.
    const url = await getDownloadUrl(file.eventId, fileId, asRequester(uploader));
    return { url, expiresInSeconds: DOWNLOAD_URL_SECONDS };
  });
}
