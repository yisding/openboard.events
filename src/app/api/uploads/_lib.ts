import { NextResponse, type NextRequest } from "next/server";
import { adminAuth, getAdminSession, portalAuth } from "@/features/auth";
import type { ContactId, EventId, FileKind, MemberRole, UserId } from "@/shared/contracts";
import { AppError, isAppError } from "@/shared/lib/errors";
import { log } from "@/shared/lib/log";
import { errorEnvelope, type AuthGuard } from "@/shared/server/handler";
import { describeFile, type FileDescriptor, type FileRequester } from "@/shared/server/r2";

/**
 * These routes are keyed by a file, not by an event in the path, so the guard has
 * no event to authorize against when defineHandler runs it. It deliberately
 * establishes nothing: every handler calls requireUploader() as its first step,
 * once the event is known from the validated input or from the file's own row.
 */
export const deferredAuth: AuthGuard = async () => null;

export type Uploader =
  | { kind: "admin"; userId: UserId; role: MemberRole }
  | { kind: "contact"; contactId: ContactId };

export function asRequester(uploader: Uploader): FileRequester {
  return uploader.kind === "admin"
    ? { kind: "admin", role: uploader.role, userId: uploader.userId }
    : { kind: "contact", contactId: uploader.contactId };
}

/**
 * Either credential is valid here — an organizer uploading a logo and a speaker
 * uploading their own headshot hit the same endpoints. Admin is tried first, and
 * an admin who is not a member of this event falls through to the portal check
 * rather than being rejected outright: the same person may hold both sessions.
 *
 * The guard asks for the *lowest* admin rank on purpose: this establishes which
 * member is acting, and the role it carries is what decides what they may do —
 * `assertMayUpload` below on the upload side, and on the download side the
 * reviewer scope `getDownloadUrl` resolves from the role and user id `asRequester`
 * hands it. Spelling the rank out keeps that policy where it is readable instead
 * of inheriting `adminAuth`'s organizer-only default.
 */
export async function requireUploader(request: NextRequest, eventId: EventId): Promise<Uploader> {
  if (await getAdminSession()) {
    try {
      const session = await adminAuth({ role: "reviewer" })(request, eventId, {});
      if (session) return { kind: "admin", userId: session.actorId as UserId, role: session.role as MemberRole };
    } catch (error) {
      if (!isAppError(error) || error.code !== "FORBIDDEN") throw error;
    }
  }
  const portal = await portalAuth()(request, eventId, {});
  if (!portal) throw new AppError("UNAUTHORIZED", "Sign in required");
  return { kind: "contact", contactId: portal.actorId as ContactId };
}

/**
 * The single 401 both file-keyed failure paths answer with. A missing row and a
 * real file whose event the caller cannot sign in to must be byte-identical —
 * same status *and* same message — or the wording alone becomes the id oracle
 * the matched status codes were meant to close.
 */
const FILE_ACCESS_DENIED = new AppError("UNAUTHORIZED", "Sign in required");

/**
 * Look up a file-keyed route's target and its acting uploader in one step, so
 * existence and authorization are decided together instead of one before the
 * other. A missing row answers with the *same* error a caller with no claim on
 * the file's event receives — there is no event to authorize a fake id against,
 * so "no such row" and "exists but not yours" become one response. Splitting
 * them (the previous `NOT_FOUND`-then-authorize order) turned the status into an
 * id oracle: 404 for an unknown id, 401 for a real file the caller could not
 * see, which is exactly the pair that lets an unauthenticated caller enumerate
 * real file ids.
 *
 * The collapse has to cover the message too: `requireUploader` surfaces the
 * portal guard's own "Portal sign-in required" / "Portal session expired"
 * wording, which a fake id (rejected before any guard runs) never reaches. Any
 * UNAUTHORIZED from resolving the uploader is therefore re-answered as the one
 * canonical envelope, so neither status nor body distinguishes the two.
 */
export async function requireFileUploader(
  request: NextRequest,
  fileId: string,
): Promise<{ file: FileDescriptor; uploader: Uploader }> {
  const file = await describeFile(fileId);
  if (!file) throw FILE_ACCESS_DENIED;
  try {
    const uploader = await requireUploader(request, file.eventId);
    return { file, uploader };
  } catch (error) {
    if (isAppError(error) && error.code === "UNAUTHORIZED") throw FILE_ACCESS_DENIED;
    throw error;
  }
}

/** Event branding belongs to the organizers; everything else a speaker owns too. */
export function assertMayUpload(kind: FileKind, uploader: Uploader): void {
  if (
    (kind === "logo" || kind === "background")
    && (uploader.kind !== "admin" || uploader.role === "reviewer")
  ) {
    throw new AppError("FORBIDDEN", "Only organizers can upload event branding");
  }
}

/** Finalize is the uploader's own step; an organizer of the event may also run it. */
export function assertMayFinalize(
  file: { uploadedByContactId: string | null; uploadedByUserId: string | null },
  uploader: Uploader,
): void {
  if (uploader.kind === "admin") return;
  if (file.uploadedByContactId !== uploader.contactId) {
    throw new AppError("FORBIDDEN", "This upload belongs to someone else");
  }
}

/**
 * defineHandler cannot pass a route param other than eventId through to a handler,
 * and the file routes are keyed by fileId, so they share this envelope instead. The
 * success and failure shapes are the same ones defineHandler produces.
 */
export async function jsonRoute<T>(request: NextRequest, route: string, run: () => Promise<T>): Promise<Response> {
  const startedAt = Date.now();
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  try {
    const data = await run();
    log({ level: "info", msg: "request.complete", requestId, feature: "uploads", route, durationMs: Date.now() - startedAt });
    return NextResponse.json({ data }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    // Previously mapped everything that was not an `AppError` — a `ZodError`
    // included — to a 500, so a malformed upload request answered `INTERNAL`
    // where every other route answers `VALIDATION` with `fieldErrors`.
    const { envelope, status, headers } = errorEnvelope(error, {
      requestId,
      feature: "uploads",
      route,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(envelope, { status, headers });
  }
}
