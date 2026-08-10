import type { NextConfig } from "next";

/**
 * Base path for the deployment.
 *
 * GitHub Pages serves a project site from a subdirectory, so every URL the app
 * emits has to be prefixed. Next handles its own bundle assets from `basePath`,
 * but files in `public/` are not rewritten — those go through `asset()` in
 * lib/assets.ts, which reads the same variable so the two cannot drift apart.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // Fully client-side: no server rendering, no routes, no API. Exports clean.
  output: "export",
  basePath: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  // The dev badge sits exactly on top of the navigation panel.
  devIndicators: false,
};

export default nextConfig;
