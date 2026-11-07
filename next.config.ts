import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Product photos are compressed to WebP client-side, but allow headroom for large originals.
    serverActions: { bodySizeLimit: "10mb" },
  },
  serverExternalPackages: ["exceljs"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
