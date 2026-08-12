import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { BRAND, SITE } from "@/lib/brand";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * `metadataBase` is the bare origin, not the site URL.
 *
 * Next builds absolute URLs for the file-convention images by joining this with
 * their path — and that path already carries the GitHub Pages `basePath`. Using
 * the full site URL here would prefix it twice and every social card would 404.
 * The canonical link is given absolutely for the same reason.
 */
const origin = new URL(SITE.url).origin;

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: SITE.title,
    template: `%s · ${BRAND.short}`,
  },
  description: SITE.description,
  applicationName: SITE.title,
  authors: [{ name: SITE.author, url: SITE.authorUrl }],
  creator: SITE.author,
  publisher: BRAND.agency,
  category: "simulation",
  keywords: [
    "mars rover simulator",
    "mars simulator",
    "curiosity rover",
    "perseverance rover",
    "gale crater",
    "mount sharp",
    "rocker-bogie",
    "MOLA elevation",
    "webgl",
    "three.js",
    "browser game",
    "space simulator",
    "planetary science",
  ],
  alternates: { canonical: SITE.url },
  openGraph: {
    type: "website",
    url: SITE.url,
    siteName: BRAND.agency,
    title: SITE.title,
    description: SITE.description,
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.title,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  appleWebApp: {
    capable: true,
    title: "Gale Crater",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false, address: false, date: false },
  other: {
    // The fiction, stated plainly for anything that reads the head.
    "x-unofficial": BRAND.disclaimer,
  },
};

export const viewport: Viewport = {
  themeColor: SITE.themeColor,
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // The canvas takes the whole viewport; a bounce or a zoom only breaks it.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

/**
 * Structured data. Search engines will happily call this a game; saying so in
 * their own vocabulary is the difference between a rich result and a blue link.
 */
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE.title,
  alternateName: `${BRAND.short} ${BRAND.missionName}`,
  url: SITE.url,
  description: SITE.description,
  applicationCategory: "GameApplication",
  applicationSubCategory: "Simulation",
  operatingSystem: "Any browser with WebGL 2",
  browserRequirements: "Requires WebGL 2",
  inLanguage: "en",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://opensource.org/licenses/MIT",
  codeRepository: SITE.repo,
  author: { "@type": "Person", name: SITE.author, url: SITE.authorUrl },
  publisher: { "@type": "Organization", name: BRAND.agency, disambiguatingDescription: BRAND.disclaimer },
  screenshot: `${SITE.url}opengraph-image.png`,
  about: [
    { "@type": "Place", name: "Gale Crater, Mars" },
    { "@type": "Thing", name: "Mars rover" },
  ],
};

/**
 * Props are declared explicitly rather than using Next's generated
 * `LayoutProps`, which only exists once a build has written .next/types — so
 * relying on it makes `tsc --noEmit` fail on a fresh clone, and in CI.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
