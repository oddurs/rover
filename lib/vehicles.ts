import { asset } from "./assets";
import { GEO } from "./rover";

/**
 * The rovers you can drive.
 *
 * Both are NASA/JPL-Caltech's own published meshes, rigged just enough at load
 * time to move. Neither ships an articulating suspension — Curiosity's arrives
 * as one fused node, and Perseverance keeps its whole linkage inside a single
 * `suspension` object — so on both of them the hull is placed by fitting a
 * plane through the six contact points. The procedural engineering model is
 * still the only one whose rocker-bogie actually works; reach it with
 * ?model=engineering.
 *
 * What *is* separable on both is the wheels, which is what lets them steer and
 * roll. Curiosity's six share one material and nothing else uses it;
 * Perseverance keeps all six inside one `Wheels_objs` node. Either way they
 * come out as one lump that splits cleanly by axle station.
 */

export type VehicleId = "curiosity" | "perseverance" | "engineering";

export interface Vehicle {
  id: VehicleId;
  label: string;
  full: string;
  url: string;
  /** Turn the source model to this app's -Z forward. */
  yaw: number;
  /** Where to find the wheels in the source file. */
  wheels: { by: "material" | "node"; name: string };
  /** Longitudinal axle stations in the source model, metres. */
  axleZ: [number, number, number];
  /** Measured wheel radius, metres. */
  wheelRadius: number;
  /** Mast head, in rover-local coordinates, for the camera mounts. */
  mastHead: [number, number, number];
  note: string;
}

/** The rover's local origin is the rocker-pivot plane, 0.6 m above the ground. */
const GROUND = -GEO.rockerPivot.y;

export const VEHICLES: Record<Exclude<VehicleId, "engineering">, Vehicle> = {
  curiosity: {
    id: "curiosity",
    label: "CURIOSITY",
    full: "Mars Science Laboratory, landed 2012",
    url: asset("/models/curiosity.glb"),
    yaw: Math.PI,
    wheels: { by: "material", name: "wheels" },
    axleZ: [1.098, -0.087, -1.161],
    wheelRadius: 0.25,
    // Measured from the mesh: the highest non-wheel vertex is the ChemCam
    // aperture at 2.22 m. The cameras sit just below, at Mastcam height.
    mastHead: [0.32, 1.97 + GROUND, -0.92],
    note: "0.5 m wheels. The suspension ships fused, so it cannot articulate.",
  },
  perseverance: {
    id: "perseverance",
    label: "PERSEVERANCE",
    full: "Mars 2020, landed 2021",
    url: asset("/models/perseverance.glb"),
    yaw: Math.PI,
    wheels: { by: "node", name: "Wheels_objs" },
    axleZ: [1.095, -0.09, -1.165],
    // 0.525 m across — measurably larger than Curiosity's, as the real ones are.
    wheelRadius: 0.2625,
    // The model's own `head` node sits at 1.92 m; Mastcam-Z rides a little higher.
    mastHead: [0.52, 2.02 + GROUND, -0.82],
    note: "0.525 m wheels, redesigned after Curiosity's tore. Suspension is one object.",
  },
};

export const DRIVEABLE: VehicleId[] = ["curiosity", "perseverance"];
