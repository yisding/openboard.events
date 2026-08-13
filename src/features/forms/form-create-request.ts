import type { StableCreateRequestId } from "@/shared/lib/stable-create-request-id";

/**
 * A collection-create failure carries whether the server may have committed
 * before the response was lost. Callers must preserve their stable row id and
 * exact payload while this is true so Retry reconciles instead of duplicating.
 */
export class FormCreateRequestError extends Error {
  constructor(message: string, readonly outcomeUnknown: boolean) {
    super(message);
    this.name = "FormCreateRequestError";
  }
}

export function formCreateOutcomeUnknown(error: unknown): boolean {
  return error instanceof FormCreateRequestError && error.outcomeUnknown;
}

export function openFormCreateLifecycle(requestId: StableCreateRequestId, outcomeUnknown: boolean): void {
  if (outcomeUnknown) return;
  requestId.reset();
  requestId.begin();
}

export function closeFormCreateLifecycle(
  requestId: StableCreateRequestId,
  outcomeUnknown: boolean,
  busy: boolean,
): boolean {
  if (busy) return false;
  if (!outcomeUnknown) requestId.reset();
  return true;
}

export async function requestFormCreate<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new FormCreateRequestError("Could not reach the server", true);
  }
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok) throw new FormCreateRequestError(
    payload?.error?.message ?? "The form could not be saved",
    response.status >= 500,
  );
  if (payload?.data === undefined) throw new FormCreateRequestError("The server response could not be confirmed", true);
  return payload.data;
}
