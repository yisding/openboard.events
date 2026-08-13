import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { buildHeadersConfig } from "./src/shared/lib/security-headers";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  async headers() {
    return buildHeadersConfig(process.env.NODE_ENV === "development");
  },
  async redirects() {
    return [
      // www serves the same Worker as the apex (wrangler.jsonc routes both),
      // but cookies are host-scoped and Google's OAuth callback is registered
      // on the apex — a sign-in started on www sets its state cookie on www
      // and loses it at the apex callback. One canonical host removes the
      // whole class of split-origin bugs, not just that one.
      // Two rules instead of one `/:path*`: OpenNext's redirect handler only
      // substitutes destination placeholders when the source match produced
      // params (`isUsingParams` in @opennextjs/aws routing/matcher.js). On the
      // bare root, `:path*` matches zero segments, params come back empty, and
      // the Location header ships the literal string `/:path*`. So the root
      // gets a placeholder-free destination, and `:path+` (one or more
      // segments) covers everything else with a param that always exists.
      {
        source: "/",
        has: [{ type: "host", value: "www.openboard.events" }],
        destination: "https://openboard.events/",
        permanent: true,
      },
      {
        source: "/:path+",
        has: [{ type: "host", value: "www.openboard.events" }],
        destination: "https://openboard.events/:path+",
        permanent: true,
      },
    ];
  },
  /**
   * Bundle diet for the Cloudflare Worker artifact.
   *
   * ## The problem
   *
   * Next's production **server** chunking is `{ filename: "[name].js",
   * chunks: "all", minChunks: 2 }` layered over webpack's stock cache groups,
   * which cap out at `minSize: 20000` and `maxInitialRequests: 30`. Those
   * defaults are tuned for a browser, where every extra chunk is another
   * request; on a Worker there is no request, only one bundle, so the tradeoff
   * runs backwards — a module webpack declines to split is a module *copied
   * into every entry that uses it*.
   *
   * With 209 server entries (146 `route.js` + 63 `page.js`) that is most of the
   * artifact. Measured by summing `bytesInOutput` over the esbuild metafile of
   * `.open-next/server-functions/default/handler.mjs`, in two throwaway trees
   * built from `git archive` — one at HEAD, one at HEAD plus this change — so
   * that neither number came from the shared working tree:
   *
   *     .next/server/app/**      8325 KiB  ->  6622 KiB   (-1703)
   *     .next/server/chunks/**   2780 KiB  ->  2469 KiB
   *     total bundled input     14395 KiB  -> 12382 KiB   (-2013)
   *     server chunks emitted        66    ->      179
   *
   * The app total falls because the shared modules webpack used to copy into
   * every entry now live once in a chunk; chunks fall too, because the copies
   * inside the old chunks are hoisted for the same reason. Lowering `minSize`
   * and lifting the request caps is what allows that hoisting.
   *
   * ## Why this does *not* name a cache group
   *
   * The obvious version of this change — one named `app-shared` cache group —
   * is what commit 4fe419a shipped and b27539a reverted after every route on
   * the deployed Worker answered with Next's static 500 page. The cause is in
   * `@opennextjs/cloudflare`'s
   * `dist/cli/build/patches/ast/webpack-runtime.js`. workerd cannot run
   * webpack's dynamic chunk require, so OpenNext unrolls it into a static
   * switch — and it enumerates the chunks with
   *
   *     readdirSync(...).filter((chunk) => /^\d+\.js$/.test(chunk))
   *
   * A *named* split chunk is emitted as `chunks/app-shared.js`, fails that
   * numeric filter, is therefore absent from the switch **and** invisible to
   * esbuild (nothing statically requires it), so the bundle silently ships
   * without it and the first `__webpack_require__.e` for that chunk throws
   * `Unknown chunk 926`. Every route needs the shared chunk, so every route
   * 500s. `next build`, `vitest` and the size gate all stay green through
   * this — the artifact is only wrong once workerd runs it.
   *
   * So the rule for this file is: **tune the knobs, never set `name`.**
   * Unnamed split chunks keep webpack's numeric ids, land as `chunks/<id>.js`,
   * and are picked up by OpenNext's patch like every other chunk. Anything
   * added here must keep that property, and must be verified by serving the
   * built artifact under workerd (`wrangler dev` against `.open-next`), not
   * only by `pnpm worker:size`.
   *
   * ## Why the guard is this specific
   *
   * `nextRuntime === "nodejs"` excludes the **edge** compilation, which
   * `isServer` also covers. Edge builds `src/middleware.ts`, which today is a
   * single file with no chunks at all (`middleware-manifest.json` lists only
   * `edge-runtime-webpack.js` and `src/middleware.js`); splitting chunks out of
   * a one-entrypoint compilation saves nothing and only risks the middleware
   * that runs on *every* request. `!dev` excludes `next dev`, which has its own
   * server chunking tuned for reload speed and no size problem to solve.
   */
  webpack(config, { isServer, dev, nextRuntime }) {
    if (!isServer || dev || nextRuntime !== "nodejs") return config;
    config.optimization ??= {};
    const previous =
      typeof config.optimization.splitChunks === "object" && config.optimization.splitChunks !== null
        ? config.optimization.splitChunks
        : {};
    config.optimization.splitChunks = {
      ...previous,
      // A shared module is worth hoisting at any size here: the alternative is
      // not "one more request", it is "one more copy in the single bundle".
      minSize: 0,
      // Both default to 30. With 355 entries that cap is what forced webpack to
      // give up and inline; there is no request budget to protect on a Worker.
      maxInitialRequests: Number.MAX_SAFE_INTEGER,
      maxAsyncRequests: Number.MAX_SAFE_INTEGER,
    };
    return config;
  },
};

export default nextConfig;
