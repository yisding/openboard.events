import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db/client";
import { apiKeyAuth } from "@/features/auth";
import { submissionStatusSchema, type SubmissionStatus } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { checkRateLimit } from "@/shared/server/rate-limit";
import { apiV1ErrorResponse, corsPreflight, privateData } from "../../../_lib";
import { listPublicSubmissions } from "../../../server/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() { return corsPreflight(); }

const NON_DRAFT_STATUSES = submissionStatusSchema.exclude(["draft"]).options;
type NonDraftStatus = Exclude<SubmissionStatus, "draft">;

function parseStatus(raw: string | null): NonDraftStatus | undefined {
  if (!raw) return undefined;
  if ((NON_DRAFT_STATUSES as readonly string[]).includes(raw)) return raw as NonDraftStatus;
  throw new AppError("VALIDATION", `status must be one of: ${NON_DRAFT_STATUSES.join(", ")}`);
}

const cursorSchema = z.string().regex(/^\d+$/, "cursor must be a submission code").optional();
const limitSchema = z.string().regex(/^\d+$/, "limit must be a positive integer").optional();

/**
 * Deliberately not built on `defineHandler`: this route answers a bare-array
 * `data` alongside a sibling `meta.nextCursor` (the catalog AC runs `.data[]`
 * directly against the response), a shape `defineHandler` cannot express — it
 * always answers `{ data }` with nothing beside it
 * (`src/shared/server/handler.ts`). Auth still goes through the same
 * `apiKeyAuth()` guard every other keyed route uses, called directly, so a
 * bad/missing key fails with 401 before any database lookup runs — the same
 * 401-before-404 guarantee `defineHandler` gives for free elsewhere. This
 * mirrors the one other documented `defineHandler` exception in the repo
 * (`app/api/internal/submissions/[eventId]/export.csv/route.ts`).
 *
 * Drafts are excluded unconditionally by `listPublicSubmissions`, independent
 * of whatever `status` this route was given — the draft-leak guard cannot be
 * turned off by omitting the filter, and `status=draft` itself is rejected.
 */
export async function GET(request: NextRequest, route: { params: Promise<{ slug: string }> }): Promise<Response> {
  try {
    const params = await route.params;
    const session = await apiKeyAuth()(request, null, params);
    const eventId = session?.eventId;
    if (!eventId) throw new AppError("UNAUTHORIZED", "Invalid API key");
    await checkRateLimit(db, { key: `v1:submissions:${session.actorId}`, limit: 300, windowMs: 5 * 60 * 1000 });

    const searchParams = request.nextUrl.searchParams;
    const status = parseStatus(searchParams.get("status"));
    const limitRaw = limitSchema.parse(searchParams.get("limit") ?? undefined);
    const cursorRaw = cursorSchema.parse(searchParams.get("cursor") ?? undefined);
    const limit = limitRaw ? Math.min(Number(limitRaw), 200) : 50;
    const cursorCode = cursorRaw ? Number(cursorRaw) : null;

    const { rows, nextCursor } = await listPublicSubmissions(eventId, { ...(status ? { status } : {}), limit, cursorCode });
    return privateData(rows, { nextCursor });
  } catch (error) {
    return apiV1ErrorResponse(error);
  }
}
