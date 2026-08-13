"use client";

import { useMutation } from "@tanstack/react-query";
import {
  composeBulkSpeakerEmailResultSchema,
  resolvedSpeakerSegmentSchema,
  type ComposeBulkSpeakerEmailInput,
  type EventId,
  type SpeakerSegmentFilter,
} from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
export {
  bulkSendPreviewFingerprint,
  canSendBulkMessage,
  chunkContactIds,
  mergeBulkSendResults,
} from "../bulk-send-attempt";

/**
 * `composeBulkSpeakerEmailInputSchema.contactIds` caps at 200 — a browser
 * `<DataTable>` selection limit (see that schema's own comment,
 * `src/shared/contracts/speaker-roster.ts`), *not* this segment's own
 * ceiling (`resolveSpeakerSegmentIn`'s `MAX_RECIPIENTS`, 2,000). A resolved
 * segment above 200 has to be sent as multiple compose calls; these two
 * pure helpers do the splitting and the result bookkeeping so `BulkSendTab`'s
 * send loop stays a thin, un-unit-testable shell.
 */
/** M46 — step 1 of "bulk segmented sends with preview": turn a filter into
 * the resolved audience (`contactIds` + counts) the compose step below
 * sends unchanged. */
export function useResolveSpeakerSegment(eventId: EventId) {
  return useMutation({
    mutationFn: (filter: SpeakerSegmentFilter) =>
      api(`comms/${eventId}/bulk-email/segment`, resolvedSpeakerSegmentSchema, { method: "POST", body: filter }),
  });
}

/**
 * M46's UI over M51's unchanged compose route (`/api/internal/speakers/…`,
 * not under `/comms/…` — it is that module's route, this tab only calls
 * it). `mode: "preview"` renders one recipient and enqueues nothing;
 * `mode: "send"` enqueues one email per resolved contact.
 */
export function useComposeBulkSpeakerEmail(eventId: EventId) {
  return useMutation({
    mutationFn: (input: ComposeBulkSpeakerEmailInput) =>
      api(`speakers/${eventId}/bulk-email`, composeBulkSpeakerEmailResultSchema, { method: "POST", body: input }),
  });
}
