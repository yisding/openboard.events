"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  conflictDtoSchema,
  scheduledSessionDtoSchema,
  type ConflictDTO,
  type EventId,
  type RoomId,
  type ScheduledSessionDTO,
  type SessionId,
} from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { useToast } from "@/shared/ui/toast";
import { agendaKeys } from "./keys";

const moveResultSchema = z.object({ session: scheduledSessionDtoSchema, conflicts: z.array(conflictDtoSchema) });

export type MoveSessionVariables = {
  id: SessionId;
  version: number;
  startsAt: string | null;
  endsAt: string | null;
  roomId: RoomId | null;
};

type MoveSessionResult = { session: ScheduledSessionDTO; conflicts: ConflictDTO[] };
type MoveSessionContext = { previous: ScheduledSessionDTO[] | undefined };

/**
 * The only write path this module calls. Every CAS check, `schedule_revision`
 * bump and outbox insert lives inside M28's `moveSession` transaction (PLAN
 * resolution #4, audited `withTx` path #8) — this hook's entire job is the
 * optimistic patch to the shared TanStack Query cache and its rollback, never
 * its own query or transaction.
 *
 * `onMutate` patches the exact cache entry `useSessions` reads
 * (`agendaKeys.sessions(eventId)`), so a failed drag snaps back to precisely
 * where it was — same cache slot, no ghost card, no duplicate. `onError`
 * distinguishes a stale `version` (HTTP 409 / `STALE_WRITE`) from any other
 * failure: a stale write also invalidates so the next render shows the other
 * admin's write, never a rolled-back guess masquerading as truth.
 */
export function useMoveSession(eventId: EventId) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = agendaKeys.sessions(eventId);

  return useMutation<MoveSessionResult, unknown, MoveSessionVariables, MoveSessionContext>({
    mutationFn: (variables) => {
      const { id, ...body } = variables;
      return api(`agenda/sessions/${id}/move?eventId=${eventId}`, moveResultSchema, { method: "POST", body });
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ScheduledSessionDTO[]>(key);
      queryClient.setQueryData<ScheduledSessionDTO[]>(key, (current) => (current ?? []).map((session) => (
        session.id === variables.id
          ? { ...session, startsAt: variables.startsAt, endsAt: variables.endsAt, roomId: variables.roomId }
          : session
      )));
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      const stale = isAppError(error) && error.code === "STALE_WRITE";
      toast(stale ? "Schedule changed — reloading the latest version" : "Could not move that session");
      // A stale write means truth moved on without us — refetch it rather than
      // leave the rolled-back (now also stale) snapshot on screen.
      if (stale) void queryClient.invalidateQueries({ queryKey: key });
    },
    // Always invalidate: the server's authoritative row — and its fresh
    // `conflicts` array — supersedes any client-computed guess, win or lose.
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: key }); },
  });
}
