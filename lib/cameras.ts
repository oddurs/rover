/**
 * Curiosity's camera suite.
 *
 * Fields of view are derived from each instrument's published detector size and
 * instantaneous field of view, which is more trustworthy than quoting a round
 * number from memory:
 *
 *   Mastcam M-34   1600x1200 @ 218 urad  ->  20.0 x 15.0 deg
 *   Mastcam M-100  1600x1200 @  74 urad  ->   6.8 x  5.1 deg
 *   Navcam         1024x1024 @ 820 urad  ->  45 deg square
 *   Hazcam         1024x1024, fisheye    -> 124 deg square
 *   ChemCam RMI    1024x1024 @  20 mrad  ->   1.15 deg, circular
 *   MARDI          1600x1200 @ 760 urad  ->  70.0 x 52.3 deg
 *
 * Frame aspect matters as much as angle: a Navcam frame is square and a
 * Mastcam frame is 4:3, so each view is masked to the shape the real detector
 * produces rather than stretched to fill a widescreen browser window.
 *
 * Mount positions are approximate — placed from published rover dimensions and
 * the geometry of the meshes here, not from the flight CAD.
 */

export type ViewId =
  | "orbit"
  | "chase"
  | "navcam"
  | "mastcam34"
  | "mastcam100"
  | "rmi"
  | "hazcam-front"
  | "hazcam-rear"
  | "mardi";

export interface View {
  id: ViewId;
  /** Short label for the HUD. */
  label: string;
  /** What the instrument actually is. */
  full: string;
  /** Vertical field of view of the frame, degrees. */
  fov: number;
  /** Frame aspect, width / height. 1 is square. */
  aspect: number;
  /** These detectors have no colour filter array. */
  mono: boolean;
  /** Equidistant fisheye rather than rectilinear. */
  fisheye: boolean;
  /** Mask the frame to a circle. */
  circular: boolean;
  /**
   * Stereo baseline, metres. Zero for the single-eye instruments.
   * Navcam and Mastcam figures are the published separations; the Hazcam one
   * is approximate.
   */
  baseline: number;
  /** Where it rides. */
  mount: "external" | "mast" | "body";
  /** Offset from the mount, rover-local metres. */
  offset: [number, number, number];
  /** Fixed aim for body-mounted instruments: [pitch, yaw] radians. */
  aim: [number, number];
  note: string;
}

/** The rover's local origin is the rocker-pivot plane, 0.6 m above the ground. */
const GROUND = -0.6;

export const VIEWS: View[] = [
  {
    id: "orbit",
    label: "ORBIT",
    full: "External orbit view",
    fov: 55,
    aspect: 0,
    mono: false,
    fisheye: false,
    circular: false,
    baseline: 0,
    mount: "external",
    offset: [0, 0, 0],
    aim: [0, 0],
    note: "Not an instrument — drag to look around the vehicle.",
  },
  {
    id: "chase",
    label: "CHASE",
    full: "External chase view",
    fov: 55,
    aspect: 0,
    mono: false,
    fisheye: false,
    circular: false,
    baseline: 0,
    mount: "external",
    offset: [0, 0, 0],
    aim: [0, 0],
    note: "Not an instrument — follows behind the vehicle.",
  },
  {
    id: "navcam",
    label: "NAVCAM",
    full: "Navigation Camera, left",
    fov: 45,
    aspect: 1,
    mono: true,
    fisheye: false,
    circular: false,
    baseline: 0.424,
    mount: "mast",
    offset: [-0.06, 0.04, -0.1],
    aim: [0, 0],
    note: "Monochrome, 45° square. The lens the drive planners actually work from.",
  },
  {
    id: "mastcam34",
    label: "MASTCAM M-34",
    full: "Mast Camera, 34 mm",
    fov: 15,
    aspect: 4 / 3,
    mono: false,
    fisheye: false,
    circular: false,
    baseline: 0.242,
    mount: "mast",
    offset: [-0.17, 0.0, -0.12],
    aim: [0, 0],
    note: "Colour, 20° × 15°. The wider of the two mast cameras.",
  },
  {
    id: "mastcam100",
    label: "MASTCAM M-100",
    full: "Mast Camera, 100 mm",
    fov: 5.1,
    aspect: 4 / 3,
    mono: false,
    fisheye: false,
    circular: false,
    baseline: 0.242,
    mount: "mast",
    offset: [0.17, 0.0, -0.12],
    aim: [0, 0],
    note: "Colour telephoto, 6.8° × 5.1°. Use it to read the far ridgelines.",
  },
  {
    id: "rmi",
    label: "CHEMCAM RMI",
    full: "ChemCam Remote Micro-Imager",
    fov: 1.15,
    aspect: 1,
    mono: true,
    fisheye: false,
    circular: true,
    baseline: 0,
    mount: "mast",
    offset: [0, 0.17, -0.08],
    aim: [0, 0],
    note: "1.15° circular field — the highest-resolution optic on the rover.",
  },
  {
    id: "hazcam-front",
    label: "HAZCAM FRONT",
    full: "Front Hazard Avoidance Camera",
    fov: 124,
    aspect: 1,
    mono: true,
    fisheye: true,
    circular: true,
    baseline: 0.166,
    mount: "body",
    offset: [-0.3, 0.68 + GROUND, -1.08],
    aim: [-0.42, 0],
    note: "Monochrome fisheye, 124°. Body-mounted low, looking down at the wheels.",
  },
  {
    id: "hazcam-rear",
    label: "HAZCAM REAR",
    full: "Rear Hazard Avoidance Camera",
    fov: 124,
    aspect: 1,
    mono: true,
    fisheye: true,
    circular: true,
    baseline: 0.166,
    mount: "body",
    offset: [0.3, 0.68 + GROUND, 1.02],
    aim: [-0.42, Math.PI],
    note: "Monochrome fisheye, looking back over the tracks you just made.",
  },
  {
    id: "mardi",
    label: "MARDI",
    full: "Mars Descent Imager",
    fov: 52.3,
    aspect: 4 / 3,
    mono: false,
    fisheye: false,
    circular: false,
    baseline: 0,
    mount: "body",
    // Outboard of the belly pan, or it stares at the underside of the hull.
    offset: [-0.82, 0.46 + GROUND, -0.62],
    aim: [-Math.PI / 2, 0],
    note: "Points straight down. Flew the landing; now images the ground beside the wheels.",
  },
];

export const VIEW_BY_ID = new Map<ViewId, View>(VIEWS.map((v) => [v.id, v]));

export function getView(id: ViewId): View {
  return VIEW_BY_ID.get(id) ?? VIEWS[0];
}
