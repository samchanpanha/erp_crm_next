// @ts-ignore - type definitions resolve once node_modules are installed
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* Keep heavy native-ish CJS deps out of the bundler (used by API routes only) */
  serverExternalPackages: ["exceljs"],
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
    outputFileTracingExcludes: {
      '*': [
        '@prisma/engines/**',
        '**/node_modules/@prisma/engines/**',
        '**/node_modules/@swc/**',
        '**/node_modules/canvas/**',
        '**/node_modules/puppeteer/**',
      ],
    },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
