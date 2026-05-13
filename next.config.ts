import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Enables a minimal `node server.js` production image when using Docker. */
  output: "standalone",
};

export default nextConfig;
