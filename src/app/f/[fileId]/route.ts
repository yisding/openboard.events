import { fileIdSchema } from "@/shared/contracts";
import { readPublicFile } from "@/shared/server/r2";

export const dynamic = "force-dynamic";

/**
 * Public file serving. No auth check: only public kinds resolve here, and a
 * private kind is indistinguishable from an unknown id — it serves solely through
 * getDownloadUrl's presigned GET. Content-Type comes from file_assets.mime, never
 * from R2 object metadata.
 */
export async function GET(_request: Request, route: { params: Promise<{ fileId: string }> }): Promise<Response> {
  const { fileId } = await route.params;
  const parsed = fileIdSchema.safeParse(fileId);
  const file = parsed.success ? await readPublicFile(parsed.data) : null;
  if (!file) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(file.body, { headers: file.headers });
}
