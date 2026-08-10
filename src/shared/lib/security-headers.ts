/**
 * Security response headers (PLAN P3-SEC), factored out of `next.config.ts`
 * so they are unit-testable without pulling in
 * `initOpenNextCloudflareForDev()`'s dev-only side effects. `next.config.ts`
 * imports `headersConfig` verbatim for its `headers()` export.
 *
 * The embed exception is load-bearing: `/embed/:path*` is iframed by other
 * sites on purpose (the widget script in `public/embed.js`), so it gets its
 * own permissive `frame-ancestors *` in place of the strict policy below —
 * never both, or the stricter one wins in older browsers and the iframe goes
 * blank (`e2e/public-embeds.spec.ts`).
 */

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next.js App Router hydrates from inline <script> tags it writes itself
  // (no nonce plumbing in this app), so script-src needs 'unsafe-inline';
  // everything else stays locked to same-origin.
  "script-src 'self' 'unsafe-inline'",
  // Inline `style={{...}}` attributes are common throughout the UI (progress
  // bars, dynamic layout); CSP2 style-src covers both <style> blocks and the
  // style attribute.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The browser uploads straight to a presigned R2 URL (src/shared/ui/app/
  // file-upload.tsx) — bytes never pass through this origin — so R2's own
  // host needs an explicit connect-src allowance or every upload 400s at the
  // CSP layer, not the network layer, which is a much harder bug to find.
  "connect-src 'self' https://*.r2.cloudflarestorage.com",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

const EMBED_CONTENT_SECURITY_POLICY = "frame-ancestors *";

const STRICT_TRANSPORT_SECURITY = "max-age=63072000; includeSubDomains; preload";

export const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "Strict-Transport-Security", value: STRICT_TRANSPORT_SECURITY },
];

// No X-Frame-Options here on purpose — see the module doc. nosniff and HSTS
// are transport/content concerns, orthogonal to framing, so both still apply.
export const EMBED_SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: EMBED_CONTENT_SECURITY_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Strict-Transport-Security", value: STRICT_TRANSPORT_SECURITY },
];

/** Shape `next.config.ts`'s `headers()` returns verbatim. */
export const headersConfig = [
  { source: "/embed/:path*", headers: EMBED_SECURITY_HEADERS },
  { source: "/((?!embed/).*)", headers: SECURITY_HEADERS },
];
