import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { headersConfig } from "./src/shared/lib/security-headers";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  async headers() {
    return headersConfig;
  },
  webpack(config, { isServer, dev }) {
    // Bundle diet for the Workers artifact: Next puts node_modules into shared
    // server chunks but duplicates first-party src/ code into every one of the
    // ~284 route bundles (~45% of the worker gzip was that duplication). Give
    // shared app code its own server chunk so each route requires it instead
    // of inlining a copy. Server-only and production-only: the client build's
    // chunking (and its budget checks) stay untouched.
    if (isServer && !dev) {
      config.optimization ??= {};
      const prev = typeof config.optimization.splitChunks === "object" ? config.optimization.splitChunks : {};
      config.optimization.splitChunks = {
        ...prev,
        chunks: "all",
        cacheGroups: {
          ...(prev.cacheGroups ?? {}),
          appShared: {
            test: /[\\/]src[\\/](shared|db|features)[\\/]/,
            name: "app-shared",
            minChunks: 2,
            chunks: "all",
            priority: 25,
            reuseExistingChunk: true,
          },
        },
      };
    }
    return config;
  },
};

export default nextConfig;
