import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { headersConfig } from "./src/shared/lib/security-headers";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  async headers() {
    return headersConfig;
  },
};

export default nextConfig;
