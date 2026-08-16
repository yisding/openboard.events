"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  conflictDtoSchema,
  scheduledSessionDtoSchema,
  type ConflictDTO,
  type EventId,
  type RoomDTO,
  type RoomId,
  type ScheduledSessionDTO,
  type SessionId,
} from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { useToast } from "@/shared/ui/toast";
import { roomCapacityWarning } from "../lib/room-capacity";
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
type MoveSessionContext = { previous: ScheduledSessionDTO[] | undefined; previousSession: ScheduledSessionDTO | undefined };

function placementChanged(left: ScheduledSessionDTO, right: ScheduledSessionDTO): boolean {
  return left.startsAt !== right.startsAt || left.endsAt !== right.endsAt || left.roomId !== right.roomId;
}

/**
 * Build the inverse only from the row the organizer actually moved and the
 * server row that committed. Its returned row version is the undo CAS token:
 * if another edit lands first, the inverse is rejected instead of overwriting
 * that newer schedule.
 */
export function undoVariablesForMove(
  previous: ScheduledSessionDTO,
  moved: ScheduledSessionDTO,
): MoveSessionVariables | null {
  if (previous.id !== moved.id || moved.rowVersion !== previous.rowVersion + 1 || !placementChanged(previous, moved)) return null;
  return {
    id: moved.id,
    version: moved.rowVersion,
    startsAt: previous.startsAt,
    endsAt: previous.endsAt,
    roomId: previous.roomId,
  };
}

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
export function useMoveSession(eventId: EventId, rooms: readonly RoomDTO[] = []) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = agendaKeys.sessions(eventId);

  const requestMove = (variables: MoveSessionVariables) => {
    const { id, ...body } = variables;
    return api(`agenda/sessions/${id}/move?eventId=${eventId}`, moveResultSchema, { method: "POST", body });
  };

  const beginOptimisticMove = async (variables: MoveSessionVariables): Promise<MoveSessionContext> => {
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<ScheduledSessionDTO[]>(key);
    const previousSession = previous?.find((session) => session.id === variables.id);
    queryClient.setQueryData<ScheduledSessionDTO[]>(key, (current) => (current ?? []).map((session) => (
      session.id === variables.id
        ? { ...session, startsAt: variables.startsAt, endsAt: variables.endsAt, roomId: variables.roomId }
        : session
    )));
    return { previous, previousSession };
  };

  const acceptServerMove = (result: MoveSessionResult) => {
    queryClient.setQueryData<ScheduledSessionDTO[]>(key, (current) => (current ?? []).map((session) => (
      session.id === result.session.id ? result.session : session
    )));
  };

  const undo = useMutation<MoveSessionResult, unknown, MoveSessionVariables, MoveSessionContext>({
    mutationFn: requestMove,
    onMutate: beginOptimisticMove,
    onSuccess: (result) => {
      acceptServerMove(result);
      toast("Move undone");
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      const stale = isAppError(error) && error.code === "STALE_WRITE";
      toast(stale
        ? "Couldn’t undo — that session changed again. Reloading the latest schedule."
        : "Could not undo that move", { kind: "error" });
      if (stale) void queryClient.invalidateQueries({ queryKey: key });
    },
    // Undo is a real move through the same endpoint: published sessions receive
    // a new schedule revision and correction notification, never a client-only
    // rewind that disagrees with speaker calendars.
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: key }); },
  });

  return useMutation<MoveSessionResult, unknown, MoveSessionVariables, MoveSessionContext>({
    mutationFn: requestMove,
    onMutate: beginOptimisticMove,
    onSuccess: (result, _variables, context) => {
      acceptServerMove(result);
      const inverse = context?.previousSession ? undoVariablesForMove(context.previousSession, result.session) : null;
      if (!inverse) return;
      // MTP-07 step 12 — the drop's half of capacity awareness, on the toast
      // that is already telling the organizer what happened and already
      // offering to put it back. A separate warning toast would compete with
      // that Undo for the same corner of the screen; a warning the organizer
      // cannot act on is just noise, and this one comes with the action.
      const capacityWarning = roomCapacityWarning(result.session, rooms);
      toast(capacityWarning
        ? `“${result.session.title}” moved — ${capacityWarning}`
        : `“${result.session.title}” moved`, {
        durationMs: 8_000,
        action: { label: "Undo", onClick: () => undo.mutate(inverse) },
      });
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      const stale = isAppError(error) && error.code === "STALE_WRITE";
      toast(stale ? "Schedule changed — reloading the latest version" : "Could not move that session", { kind: "error" });
      // A stale write means truth moved on without us — refetch it rather than
      // leave the rolled-back (now also stale) snapshot on screen.
      if (stale) void queryClient.invalidateQueries({ queryKey: key });
    },
    // Always invalidate: the server's authoritative row — and its fresh
    // `conflicts` array — supersedes any client-computed guess, win or lose.
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: key }); },
  });
}
