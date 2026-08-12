/**
 * The Office of Planetary Locomotion.
 *
 * The simulator is dressed as the public face of a space agency that does not
 * exist — a small, over-serious bureau whose entire remit is driving. The
 * fiction is doing real work: it gives the interface a reason to look like
 * mission control, and it gives the copy a voice.
 *
 * It is a homage, not a costume. No agency name, seal, wordmark or insignia
 * belonging to anyone real appears anywhere in the brand, and every surface
 * that carries it also carries the disclaimer below. The data and the meshes
 * come from NASA and are credited in NOTICE; the letterhead does not.
 */

export const BRAND = {
  /** Formal name, for letterheads and structured data. */
  agency: "Office of Planetary Locomotion",
  /** How it signs itself. */
  short: "OPL",
  /** The bureau within the bureau. */
  division: "Surface Mobility Division",
  /**
   * A motto, in the tradition of agencies that pick something in Latin about
   * reaching the stars. This one is Curiosity's actual top speed.
   */
  motto: "Four centimetres per second",
  /** Mission designation, in the style of a real one and meaning nothing. */
  mission: "GCS-1",
  missionName: "Gale Crater Surface Operations",
  /** Nobody is fooled, but say it anyway — on every surface. */
  disclaimer:
    "An unofficial fan project. Not affiliated with, endorsed by, or connected to NASA, JPL, Caltech or any government agency.",
  disclaimerShort: "Unofficial · not affiliated with NASA or JPL",
} as const;

export const SITE = {
  /** Canonical origin. Metadata and structured data are absolute against it. */
  url: "https://oddurs.github.io/rover/",
  repo: "https://github.com/oddurs/rover",
  title: "Gale Crater — Mars Rover Simulator",
  tagline: "Drive a Mars rover in your browser.",
  description:
    "Drive a six-wheel rocker-bogie rover across Gale Crater in your browser. Built on real MOLA laser altimetry, with Curiosity's own 4.2 cm/s top speed, its camera suite, and Mount Sharp on the horizon where it actually is.",
  /** Chrome's address bar and the PWA splash. Matches the page background. */
  themeColor: "#0b0705",
  author: "Oddur Sigurdsson",
  authorUrl: "https://github.com/oddurs",
} as const;
