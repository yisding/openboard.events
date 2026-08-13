import type { APIRequestContext } from "@playwright/test";
import { apiData } from "./auth";

type AgendaSession = { id: string; title: string; rowVersion: number };

/**
 * Remove matching test sessions with their latest optimistic-lock version.
 * Re-read once on conflict so a cleanup still succeeds when the test's final
 * action changed the row between creation and teardown.
 */
export async function deleteAgendaSessionsWhere(
  request: APIRequestContext,
  eventId: string,
  matches: (session: AgendaSession) => boolean,
): Promise<void> {
  const listPath = `/api/internal/agenda/sessions?eventId=${encodeURIComponent(eventId)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sessions = await apiData<AgendaSession[]>(request, listPath);
    const targets = sessions.filter(matches);
    if (targets.length === 0) return;

    try {
      for (const session of targets) {
        await apiData(
          request,
          `/api/internal/agenda/sessions/${session.id}?eventId=${encodeURIComponent(eventId)}`,
          { method: "DELETE", data: { expectedVersion: session.rowVersion } },
        );
      }
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

export type SpeakerPublicSnapshot = {
  bioHtml: string | null;
  confirmationStatus: "unconfirmed" | "confirmed" | "declined";
};

/** Capture the exact public speaker fields a test is about to mutate. */
export async function getSpeakerPublicSnapshot(
  request: APIRequestContext,
  eventId: string,
  contactId: string,
): Promise<SpeakerPublicSnapshot> {
  const detail = await apiData<{ contact: SpeakerPublicSnapshot }>(
    request,
    `/api/internal/speakers/${eventId}/${contactId}`,
  );
  return detail.contact;
}

/** Restore only the captured field, leaving unrelated concurrent edits alone. */
export async function restoreSpeakerConfirmation(
  request: APIRequestContext,
  eventId: string,
  contactId: string,
  confirmationStatus: SpeakerPublicSnapshot["confirmationStatus"],
): Promise<void> {
  await apiData(request, `/api/internal/speakers/${eventId}/${contactId}`, {
    method: "PATCH",
    data: { confirmationStatus },
  });
}

export async function restoreSpeakerBio(
  request: APIRequestContext,
  eventId: string,
  contactId: string,
  bioHtml: string,
): Promise<void> {
  await apiData(request, `/api/internal/speakers/${eventId}/${contactId}`, {
    method: "PATCH",
    data: { bioHtml },
  });
}
