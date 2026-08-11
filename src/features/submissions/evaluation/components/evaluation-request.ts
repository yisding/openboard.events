export type EvaluationRequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "response" | "transport"; message: string };

type Requester = (input: string, init?: RequestInit) => Promise<Response>;

export function evaluationFailureMessage(failure: { kind: "response" | "transport"; message: string }): string {
  return failure.kind === "transport"
    ? `${failure.message} — check your connection and try again`
    : failure.message;
}

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
      return { ok: false, kind: "response", message: payload?.error?.message ?? fallbackMessage };
    }
    return { ok: true, data: payload.data };
  } catch {
    return { ok: false, kind: "transport", message: fallbackMessage };
  }
}
