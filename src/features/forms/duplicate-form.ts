import type { BuilderForm } from "./builder-types";

export class FormDuplicateRequestError extends Error {
  constructor(message: string, readonly outcomeUnknown: boolean) {
    super(message);
    this.name = "FormDuplicateRequestError";
  }
}

export function formDuplicateOutcomeUnknown(error: unknown): boolean {
  return error instanceof FormDuplicateRequestError && error.outcomeUnknown;
}

/**
 * Duplicate through the generic form endpoint shared by CFP and portal forms.
 *
 * The endpoint generates the new form id server-side, so a response lost after
 * commit cannot be retried safely from the same screen. Preserve that
 * distinction for callers: a definite 4xx may be retried, while transport,
 * malformed-success and 5xx failures tell the organizer to inspect the form
 * list before trying again.
 */
export async function duplicateFormAsDraft(
  eventId: string,
  formId: string,
  request: typeof fetch = fetch,
): Promise<BuilderForm> {
  let response: Response;
  try {
    response = await request(`/api/internal/forms/${formId}/duplicate?eventId=${eventId}`, { method: "POST" });
  } catch {
    throw new FormDuplicateRequestError("Could not reach the server", true);
  }

  const payload = await response.json().catch(() => null) as {
    data?: BuilderForm;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new FormDuplicateRequestError(
      payload?.error?.message ?? "The form could not be duplicated",
      response.status >= 500,
    );
  }
  if (!payload?.data) {
    throw new FormDuplicateRequestError("The duplicate could not be confirmed", true);
  }
  return payload.data;
}
