// @ts-ignore - type definitions resolve once node_modules are installed
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* Keep heavy native-ish CJS deps out of the bundler (used by API routes only) */
  serverExternalPackages: ["exceljs"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
