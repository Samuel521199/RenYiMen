import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Enables a minimal `node server.js` production image when using Docker. */
  output: "standalone",
  // Keep CI/verification builds isolated from a concurrently running local
  // development server, which owns the default .next directory.
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
};

export default nextConfig;
