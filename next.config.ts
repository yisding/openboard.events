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
   * Temporary Cloudflare Worker size compatibility override.
   *
   * Measured with Next 15.5.23, @opennextjs/cloudflare 1.20.2, and
   * Wrangler 4.120.0 on 2026-08-14:
   *
   * - Next defaults: 75 server chunks, 758 handler inputs, 3,329.11 KiB gzip
   * - This override: 257 server chunks, 940 handler inputs, 2,561.52 KiB gzip
   *
   * The default therefore exceeds Cloudflare's 3 MiB compressed Worker limit.
   * OpenNext 1.20.2 also discovers only numeric server chunk filenames, so do
   * not add a splitChunks `name` function here. Remove this override only after
   * the default bundle is below the limit and the full workerd matrix passes.
   */
  webpack(config, { isServer, dev, nextRuntime }) {
    if (!isServer || dev || nextRuntime !== "nodejs") {
      return config;
    }

    config.optimization ??= {};
    const previousSplitChunks =
      typeof config.optimization.splitChunks === "object" &&
      config.optimization.splitChunks !== null
        ? config.optimization.splitChunks
        : {};

    config.optimization.splitChunks = {
      ...previousSplitChunks,
      minSize: 0,
      maxInitialRequests: Number.MAX_SAFE_INTEGER,
      maxAsyncRequests: Number.MAX_SAFE_INTEGER,
    };

    return config;
  },
};

export default nextConfig;
