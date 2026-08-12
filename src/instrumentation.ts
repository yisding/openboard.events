import type { Instrumentation } from "next";
import { captureError } from "@/shared/lib/error-tracking";

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isExpectedNextControlFlow(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string"
    && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}

/** Capture render, Server Action, middleware, and non-wrapped route failures. */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  if (isExpectedNextControlFlow(error)) return;
  captureError(error, {
    requestId: headerValue(request.headers["cf-ray"]) ?? crypto.randomUUID(),
    feature: `next-${context.routeType}`,
    code: "UNCAUGHT_REQUEST_ERROR",
    route: context.routePath,
  });
};
