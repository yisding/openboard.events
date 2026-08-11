export type EvaluationRequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

type Requester = (input: string, init?: RequestInit) => Promise<Response>;

/** Normalizes HTTP, malformed-response, and transport failures for evaluation
 * drawers. A failed button-triggered request must always resolve to feedback
 * the drawer can show while keeping the organizer's work open. */
export async function evaluationRequest<T>(
  input: string,
  init: RequestInit,
  fallbackMessage: string,
  request: Requester = fetch,
): Promise<EvaluationRequestResult<T>> {
  try {
    const response = await request(input, init);
    const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
    if (!response.ok || payload?.data === undefined) {
      return { ok: false, message: payload?.error?.message ?? fallbackMessage };
    }
    return { ok: true, data: payload.data };
  } catch {
    return { ok: false, message: fallbackMessage };
  }
}
