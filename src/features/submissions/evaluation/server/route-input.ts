import { NextRequest } from "next/server";

/**
 * `defineHandler` takes a non-GET request's whole body as its input, so a path
 * parameter like `planId` has to be folded into that body before it is parsed.
 * Rebuilding the request keeps each route on one validated input object instead
 * of a schema-checked body plus a hand-read, unchecked path string.
 *
 * The path always wins: `/plans/A` may not edit plan B because the body said so.
 */
export async function requestWithPathValues(
  request: NextRequest,
  values: Record<string, string>,
): Promise<NextRequest> {
  const text = await request.text();
  const headers = new Headers(request.headers);
  headers.delete("content-length");

  let parsed: unknown = {};
  try {
    if (text.trim().length > 0) parsed = JSON.parse(text);
  } catch {
    // Let the handler report the malformed JSON rather than swallowing it here.
    return new NextRequest(request.url, { method: request.method, headers, body: text });
  }

  const body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? { ...parsed, ...values }
    : values;
  return new NextRequest(request.url, { method: request.method, headers, body: JSON.stringify(body) });
}
