import type { MetadataRoute } from "next";

import { SITE } from "@/lib/brand";

/**
 * Crawlers only read robots.txt from the root of a host, and this deploys to a
 * subdirectory of one — so this file is advisory rather than binding. It costs
 * nothing, and it stops being a lie the day the project gets its own domain.
 */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE.url}sitemap.xml`,
  };
}
