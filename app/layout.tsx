import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gale Crater — Mars Rover Simulator",
  description:
    "Drive a rocker-bogie rover across Gale Crater, built on real MOLA laser altimetry from Mars Global Surveyor.",
};

export const viewport: Viewport = {
  themeColor: "#0b0705",
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
      <body className="h-full">{children}</body>
    </html>
  );
}
