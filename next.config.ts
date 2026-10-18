// @ts-ignore - type definitions resolve once node_modules are installed
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* Keep heavy native-ish CJS deps out of the bundler (used by API routes only) */
  serverExternalPackages: ["exceljs"],
  productionBrowserSourceMaps: false,
  outputFileTracingExcludes: {
    '*': [
      'node_modules/@swc/core*/**',
      'node_modules/typescript/**',
      'node_modules/@types/**',
      'node_modules/eslint/**',
      'node_modules/prettier/**',
      'node_modules/@prisma/engines/**',
      'node_modules/prisma/**',
      'node_modules/canvas/**',
      'node_modules/puppeteer/**',
      'node_modules/sharp/**',
      './tool-results/**',
      './download/**',
      './worklog.md',
      '**/*.map',
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
