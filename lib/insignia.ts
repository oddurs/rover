/**
 * The insignia.
 *
 * Every agency badge of the era is built from the same four parts: a deep blue
 * disc for space, stars scattered across it, an ellipse for an orbit, and one
 * bold shape sweeping through the middle. This one keeps the grammar and
 * changes the noun — the sweep is a tyre track, treads and all, because this
 * is an agency about driving. The letters are drawn as tubes of constant width
 * with rounded ends, the way logotypes were cut in the seventies.
 *
 * It is authored once, here, as a string. `components/Insignia.tsx` inlines it,
 * and `tools/render_brand.mjs` imports this same module to rasterise the
 * favicon, the app icons and the social card, so the mark cannot drift between
 * the interface and the metadata.
 *
 * Drawn on a 100×100 grid so it scales anywhere, and legible at 16 px, which is
 * the size that actually decides whether a favicon works.
 */

const DISC_DARK = "#0a1224";
const AMBER = "#ff9d4d";
const TRACK = "#e8552f";

/** The mark itself, with no wrapping element — a standalone SVG document. */
export const INSIGNIA_SVG = /* html */ `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Office of Planetary Locomotion insignia">
  <defs>
    <radialGradient id="opl-disc" cx="36%" cy="26%" r="82%">
      <stop offset="0" stop-color="#1b2b4d"/>
      <stop offset="0.62" stop-color="#0d1730"/>
      <stop offset="1" stop-color="#060a16"/>
    </radialGradient>
    <clipPath id="opl-ball"><circle cx="50" cy="50" r="47"/></clipPath>
  </defs>

  <circle cx="50" cy="50" r="47" fill="url(#opl-disc)"/>

  <g clip-path="url(#opl-ball)">
    <g fill="#ffffff">
      <circle cx="16" cy="27" r="1.05"/>
      <circle cx="27" cy="15" r="0.8"/>
      <circle cx="39" cy="23" r="0.6"/>
      <circle cx="52" cy="12" r="0.95"/>
      <circle cx="66" cy="20" r="0.7"/>
      <circle cx="79" cy="28" r="0.85"/>
      <circle cx="87" cy="17" r="0.55"/>
      <circle cx="12" cy="40" r="0.6"/>
      <circle cx="89" cy="45" r="0.75"/>
      <circle cx="70" cy="9" r="0.5"/>
      <circle cx="33" cy="31" r="0.5"/>
      <circle cx="59" cy="27" r="0.55"/>
    </g>

    <!-- The tyre track. A band with grooves punched through it: the groove
         stroke is as wide as the band and painted in the disc colour, so the
         dash gaps read as tread rather than as dashes. -->
    <path d="M 4,75 C 28,60 52,53 98,42 L 98,50.5 C 54,61.5 30,68.5 8,83 Z" fill="${TRACK}"/>
    <path d="M 6,79 C 30,64.5 54,57.5 98,46.5" fill="none" stroke="${DISC_DARK}"
          stroke-width="10" stroke-dasharray="1.7 7.4" stroke-opacity="0.92"/>
  </g>

  <!-- OPL, in tubes of constant width. Painted twice: once fat in the disc
       colour to hold the letters off the track, then white on top. -->
  <g transform="translate(50 44) scale(0.86) translate(-46.65 -42)"
     fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="${DISC_DARK}" stroke-width="12" stroke-opacity="0.85">
      <circle cx="27" cy="42" r="7.2"/>
      <path d="M 46,34.8 L 46,49.2"/>
      <path d="M 46,34.8 L 49.5,34.8 A 3.6,3.6 0 0 1 49.5,42 L 46,42"/>
      <path d="M 65,34.8 L 65,49.2 L 73.5,49.2"/>
    </g>
    <g stroke="#ffffff" stroke-width="7">
      <circle cx="27" cy="42" r="7.2"/>
      <path d="M 46,34.8 L 46,49.2"/>
      <path d="M 46,34.8 L 49.5,34.8 A 3.6,3.6 0 0 1 49.5,42 L 46,42"/>
      <path d="M 65,34.8 L 65,49.2 L 73.5,49.2"/>
    </g>
  </g>

  <!-- The orbit crosses over the letters, as it always does. -->
  <ellipse cx="50" cy="50" rx="44.5" ry="15" transform="rotate(-24 50 50)"
           fill="none" stroke="${AMBER}" stroke-width="1.5" stroke-opacity="0.62"/>

  <circle cx="50" cy="50" r="47" fill="none" stroke="${AMBER}"
          stroke-width="1.6" stroke-opacity="0.5"/>
</svg>`;

/**
 * A one-line lockup for tight spaces: the track sweep and the letters, no disc.
 * Reads at the size of a line of type, where the full badge would turn to mud.
 */
export const WORDMARK_SVG = /* html */ `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 26" role="img" aria-label="OPL">
  <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4.6">
    <circle cx="13" cy="13" r="8.6"/>
    <path d="M 34,4.6 L 34,21.4"/>
    <path d="M 34,4.6 L 38.4,4.6 A 4.3,4.3 0 0 1 38.4,13.2 L 34,13.2"/>
    <path d="M 57,4.6 L 57,21.4 L 67.5,21.4"/>
  </g>
  <path d="M 75,22 C 80,16 85,12 94,8.5" fill="none" stroke="currentColor"
        stroke-width="3.4" stroke-linecap="round" stroke-opacity="0.55"/>
</svg>`;
