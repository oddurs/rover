import type { MetadataRoute } from "next";

import { asset } from "@/lib/assets";
import { BRAND, SITE } from "@/lib/brand";

/**
 * Web app manifest. Installed to a home screen this should come up the way the
 * simulator wants to be looked at: full bleed, landscape, no browser chrome.
 *
 * Icon paths live in `public/` and so are not rewritten for the GitHub Pages
 * subdirectory automatically — they go through `asset()` like every other file
 * the app fetches.
 */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE.title} · ${BRAND.short}`,
    short_name: "Gale Crater",
    description: SITE.description,
    start_url: asset("/"),
    scope: asset("/"),
    display: "fullscreen",
    orientation: "landscape",
    background_color: SITE.themeColor,
    theme_color: SITE.themeColor,
    categories: ["education", "entertainment", "games"],
    icons: [
      { src: asset("/brand/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: asset("/brand/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: asset("/brand/maskable-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
