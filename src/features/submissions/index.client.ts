/**
 * What a client component may import. The server barrel reaches the database and
 * the session through `@/features/portal` and `@/features/auth`, so importing a
 * pure helper from it drags `next/headers` into the browser bundle and the build
 * fails — which is how this file came to exist.
 */
export { formatCode, toPortalStatus } from "./server/guards";
