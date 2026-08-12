import type { MetadataRoute } from "next";

import { SITE } from "@/lib/brand";

/** One page, which is the whole point of it. */
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE.url,
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
