"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { scheduledSessionDtoSchema, type EventId, type SessionId, type SubmissionId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { agendaKeys } from "./keys";

const savedSchema = scheduledSessionDtoSchema;
const promotedSchema = z.object({ sessionId: z.uuid() });
const bulkSchema = z.object({ changed: z.int().nonnegative(), emailsQueued: z.int().nonnegative() });
const deletedSchema = z.object({ deleted: z.boolean() });

export type SaveSessionPayload = {
  id?: SessionId;
  expectedVersion?: number;
  title: string;
  descriptionHtml: string;
  formatId: string | null;
  trackId: string | null;
  roomId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  speakerContactIds: string[];
  status: "draft" | "published";
};

/**
 * Every write the agenda's UI makes, with one invalidation rule between them.
 *
 * `router.refresh()` runs alongside the cache invalidation because the page's
 * conflicts, vocabulary and accepted list are server-rendered props, not query
 * data — refreshing the route is what keeps the Conflicts badge honest after a
 * save that created an overlap.
 */
export function useSessionMutations(eventId: EventId) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const settle = async () => {
    await queryClient.invalidateQueries({ queryKey: agendaKeys.allSessions(eventId) });
    router.refresh();
  };

  const save = useMutation({
    mutationFn: (payload: SaveSessionPayload) => {
      const { id, ...body } = payload;
      return id
        ? api(`agenda/sessions/${id}?eventId=${eventId}`, savedSchema, { method: "PATCH", body })
        : api(`agenda/sessions?eventId=${eventId}`, savedSchema, { method: "POST", body });
    },
    onSuccess: settle,
  });

  const remove = useMutation({
    mutationFn: ({ id, expectedVersion }: { id: SessionId; expectedVersion: number }) =>
      api(`agenda/sessions/${id}?eventId=${eventId}`, deletedSchema, { method: "DELETE", body: { expectedVersion } }),
    onSuccess: settle,
  });

  const setPublished = useMutation({
    mutationFn: ({ ids, published }: { ids: SessionId[]; published: boolean }) =>
      api(`agenda/sessions/bulk-publish?eventId=${eventId}`, bulkSchema, { method: "POST", body: { ids, published } }),
    onSuccess: settle,
  });

  const promote = useMutation({
    mutationFn: (submissionId: SubmissionId) =>
      api(`agenda/promote?eventId=${eventId}`, promotedSchema, { method: "POST", body: { submissionId } }),
    onSuccess: settle,
  });

  // M52 — restore an earlier content revision as the session's current
  // title/description. Same settle rule as every other write here.
  const restoreContent = useMutation({
    mutationFn: ({ id, revisionId }: { id: SessionId; revisionId: string }) =>
      api(`agenda/sessions/${id}/revisions?eventId=${eventId}`, savedSchema, { method: "POST", body: { revisionId } }),
    onSuccess: settle,
  });

  return { save, remove, setPublished, promote, restoreContent };
}
