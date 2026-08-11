export type TaskMutationPayload<T> = { data?: T; error?: { message?: string } };
export type TaskMutationResult<T> =
  | { ok: true; payload: TaskMutationPayload<T> | null }
  | { ok: false; payload: TaskMutationPayload<T> | null; message: string };

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Normalizes HTTP and transport failures so a button-triggered mutation never
 * escapes as an unhandled rejected promise. */
export async function taskMutation<T>(
  input: string,
  init: RequestInit,
  fallbackMessage: string,
  fetcher: Fetcher = (url, options) => fetch(url, options),
): Promise<TaskMutationResult<T>> {
  try {
    const response = await fetcher(input, init);
    const payload = await response.json().catch(() => null) as TaskMutationPayload<T> | null;
    if (!response.ok) return { ok: false, payload, message: payload?.error?.message ?? fallbackMessage };
    return { ok: true, payload };
  } catch {
    return { ok: false, payload: null, message: fallbackMessage };
  }
}
