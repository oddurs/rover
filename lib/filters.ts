/**
 * Mastcam's science filter wheel.
 *
 * Each Mastcam carries eight positions: a clear one that passes the Bayer
 * colour through, six narrow science bands, and a solar filter dense enough to
 * point the instrument straight at the sun without wrecking the detector. The
 * science frames come back as single-band greyscale, not colour, which is why
 * the colour images you see are composites of several.
 *
 * The renderer only has visible RGB to work with, so the visible bands are a
 * weighted response over it and the near-infrared bands extrapolate from red —
 * dust is bright in the near infrared, hence the rising gain. The band centres
 * and the wheel layout are real; the response curves are an approximation.
 */

export interface Filter {
  id: string;
  label: string;
  /** Band centre, nanometres. Zero for the clear position. */
  nm: number;
  /** Response over the rendered RGB. Null passes colour through untouched. */
  weights: [number, number, number] | null;
  gain: number;
  /** Neutral density, as a multiplier. */
  nd: number;
  note: string;
}

export const FILTERS: Filter[] = [
  {
    id: "L0",
    label: "L0 CLEAR",
    nm: 0,
    weights: null,
    gain: 1,
    nd: 1,
    note: "Bayer colour, no filter in the path.",
  },
  {
    id: "L2",
    label: "L2 445",
    nm: 445,
    weights: [0.02, 0.16, 0.82],
    gain: 1.9,
    nd: 1,
    note: "Blue. Mars is dark here, so it needs the gain.",
  },
  {
    id: "L1",
    label: "L1 527",
    nm: 527,
    weights: [0.16, 0.78, 0.06],
    gain: 1.3,
    nd: 1,
    note: "Green.",
  },
  {
    id: "L4",
    label: "L4 676",
    nm: 676,
    weights: [0.9, 0.1, 0.0],
    gain: 1.0,
    nd: 1,
    note: "Red. Close to where the dust is brightest in the visible.",
  },
  {
    id: "L3",
    label: "L3 751",
    nm: 751,
    weights: [1.0, 0.0, 0.0],
    gain: 1.08,
    nd: 1,
    note: "Near infrared. Ferric minerals start to separate here.",
  },
  {
    id: "L5",
    label: "L5 867",
    nm: 867,
    weights: [1.0, 0.0, 0.0],
    gain: 1.16,
    nd: 1,
    note: "Near infrared.",
  },
  {
    id: "L6",
    label: "L6 1012",
    nm: 1012,
    weights: [1.0, 0.0, 0.0],
    gain: 1.22,
    nd: 1,
    note: "The far end of the detector's response.",
  },
  {
    id: "L7",
    label: "L7 SOLAR",
    nm: 440,
    weights: [0.1, 0.3, 0.6],
    gain: 1.0,
    nd: 0.00035,
    note: "Solar. Dense enough to look straight at the sun — and at nothing else.",
  },
];

export const FILTER_BY_ID = new Map(FILTERS.map((f) => [f.id, f]));

export function getFilter(id: string): Filter {
  return FILTER_BY_ID.get(id) ?? FILTERS[0];
}
