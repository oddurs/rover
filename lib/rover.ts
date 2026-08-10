/**
 * Rocker-bogie suspension, solved kinematically.
 *
 * Real rovers use a passive linkage: a *rocker* pivots on the chassis with the
 * front wheel at one end and a *bogie* at the other; the bogie carries the
 * middle and rear wheels. A differential bar across the hull ties the two
 * rockers together so the chassis pitches to the average of the two sides.
 * The result keeps all six wheels loaded over obstacles up to about a wheel
 * diameter tall.
 *
 * We solve it kinematically rather than with rigid-body physics: sample the
 * ground under each wheel, then work *up* the linkage to find the bogie pivot,
 * the rocker pivot, and finally the chassis. This can't explode, jitter, or
 * launch the rover into orbit, which matters more for a sandbox than
 * simulating the actual joint torques.
 *
 * Local frame: +X right, +Y up, -Z forward.
 */

import { sampleHeight } from "./terrain";

export const GEO = {
  wheelRadius: 0.25,
  wheelWidth: 0.4,
  /** Half the distance between left and right wheel centrelines. */
  halfTrack: 1.15,

  /** Wheel contact points along Z at rest, relative to the rover origin. */
  zFront: -1.15,
  zMiddle: -0.05,
  zRear: 1.05,

  /** Rocker pivot on the chassis. */
  rockerPivot: { z: -0.1, y: 0.6 },
  /** Bogie pivot at the rear end of the rocker. */
  bogiePivot: { z: 0.45, y: 0.42 },

  /** Travel limits, radians. Beyond these the real linkage hits its stops. */
  rockerLimit: 0.55,
  bogieLimit: 0.65,
} as const;

const AXLE_Y = GEO.wheelRadius;

// Rest geometry, derived once.
const REST = {
  bogieMidZ: (GEO.zMiddle + GEO.zRear) / 2,
  bogieHalfSpan: (GEO.zRear - GEO.zMiddle) / 2,
  // Offset from the middle/rear axle midpoint to the bogie pivot.
  bogieOffZ: GEO.bogiePivot.z - (GEO.zMiddle + GEO.zRear) / 2,
  bogieOffY: GEO.bogiePivot.y - AXLE_Y,

  rockerSpanZ: GEO.bogiePivot.z - GEO.zFront,
  rockerAngle: Math.atan2(GEO.bogiePivot.y - AXLE_Y, GEO.bogiePivot.z - GEO.zFront),
  // Offset from the front-axle/bogie-pivot midpoint to the rocker pivot.
  rockerOffZ: GEO.rockerPivot.z - (GEO.zFront + GEO.bogiePivot.z) / 2,
  rockerOffY: GEO.rockerPivot.y - (AXLE_Y + GEO.bogiePivot.y) / 2,
};

function rotZY(z: number, y: number, a: number): [number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [z * c - y * s, z * s + y * c];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export interface SideSolution {
  /** Rocker rotation from rest, radians. Positive means the rear end is up. */
  rockerAngle: number;
  /** Bogie rotation from rest, radians. */
  bogieAngle: number;
  /** Height of the rocker pivot above the terrain datum. */
  pivotY: number;
  /** Ground clearance under each wheel, metres. */
  wheelY: [number, number, number];
}

/**
 * Solve one side of the linkage from three ground heights.
 * Heights are the terrain surface under the front, middle and rear wheels.
 */
export function solveSide(gFront: number, gMiddle: number, gRear: number): SideSolution {
  const yF = gFront + GEO.wheelRadius;
  const yM = gMiddle + GEO.wheelRadius;
  const yR = gRear + GEO.wheelRadius;

  // Bogie: rotate to span the middle and rear contacts.
  const bogieAngle = clamp(
    Math.atan2(yR - yM, GEO.zRear - GEO.zMiddle),
    -GEO.bogieLimit,
    GEO.bogieLimit
  );
  const [bpz, bpy] = rotZY(REST.bogieOffZ, REST.bogieOffY, bogieAngle);
  const bogiePivotZ = REST.bogieMidZ + bpz;
  const bogiePivotY = (yM + yR) / 2 + bpy;

  // Rocker: spans the front contact and the bogie pivot.
  const rockerAngle = clamp(
    Math.atan2(bogiePivotY - yF, bogiePivotZ - GEO.zFront) - REST.rockerAngle,
    -GEO.rockerLimit,
    GEO.rockerLimit
  );
  const [, rpy] = rotZY(REST.rockerOffZ, REST.rockerOffY, rockerAngle);
  const pivotY = (yF + bogiePivotY) / 2 + rpy;

  return { rockerAngle, bogieAngle, pivotY, wheelY: [yF, yM, yR] };
}

/** Wheel contact stations in the rover frame: L then R, front to rear. */
export const WHEEL_STATIONS: [number, number][] = [
  [-GEO.halfTrack, GEO.zFront],
  [-GEO.halfTrack, GEO.zMiddle],
  [-GEO.halfTrack, GEO.zRear],
  [GEO.halfTrack, GEO.zFront],
  [GEO.halfTrack, GEO.zMiddle],
  [GEO.halfTrack, GEO.zRear],
];

export interface RoverPose {
  /** Chassis position, world space. Y is the rocker-pivot plane. */
  position: [number, number, number];
  /** Radians. */
  yaw: number;
  pitch: number;
  roll: number;
  left: SideSolution;
  right: SideSolution;
  /** Terrain slope along the direction of travel, degrees. Positive is uphill. */
  gradeDeg: number;
}

/**
 * Place the rover on the terrain at a given position and heading.
 *
 * Wheel ground positions are computed from yaw alone — feeding pitch and roll
 * back in would need an iteration, and at these attitudes it moves the contact
 * points by a few centimetres at most.
 */
export function solvePose(
  x: number,
  z: number,
  yaw: number,
  rigid = false
): RoverPose {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);

  // Local (lx, lz) -> world. Yaw rotates about +Y.
  const toWorld = (lx: number, lz: number): [number, number] => [
    x + lx * cy + lz * sy,
    z - lx * sy + lz * cy,
  ];

  const g: number[] = [];
  for (const [lx, lz] of WHEEL_STATIONS) {
    const [wx, wz] = toWorld(lx, lz);
    g.push(sampleHeight(wx, wz));
  }

  const left = solveSide(g[0], g[1], g[2]);
  const right = solveSide(g[3], g[4], g[5]);

  let pitch: number;
  let roll: number;
  let pivotY: number;

  if (rigid) {
    // A vehicle whose suspension cannot move is best placed by the plane that
    // fits its six contact points, not by a linkage solution it doesn't have.
    // Least squares over a symmetric wheel layout reduces to two independent
    // slopes once the longitudinal stations are mean-centred.
    const axle = g.map((h) => h + GEO.wheelRadius);
    const meanLz =
      WHEEL_STATIONS.reduce((a, s) => a + s[1], 0) / WHEEL_STATIONS.length;

    let a = 0;
    let sxh = 0;
    let sxx = 0;
    let szh = 0;
    let szz = 0;
    for (let i = 0; i < 6; i++) {
      a += axle[i] / 6;
    }
    for (let i = 0; i < 6; i++) {
      const lx = WHEEL_STATIONS[i][0];
      const lzc = WHEEL_STATIONS[i][1] - meanLz;
      sxh += lx * axle[i];
      sxx += lx * lx;
      szh += lzc * axle[i];
      szz += lzc * lzc;
    }
    const bx = sxh / sxx; // slope across the vehicle
    const bz = szh / szz; // slope along it

    roll = Math.atan(bx);
    pitch = Math.atan(-bz);
    pivotY = a - bz * meanLz + (GEO.rockerPivot.y - GEO.wheelRadius);
  } else {
    // The differential bar averages the two rockers into chassis pitch.
    pitch = -(left.rockerAngle + right.rockerAngle) / 2;
    roll = Math.atan2(right.pivotY - left.pivotY, 2 * GEO.halfTrack);
    pivotY = (left.pivotY + right.pivotY) / 2;
  }

  // Grade along travel, for the telemetry readout and the drive model.
  const ahead = 3;
  const [ax, az] = toWorld(0, -ahead);
  const [bx2, bz2] = toWorld(0, ahead);
  const gradeDeg =
    (Math.atan2(sampleHeight(ax, az) - sampleHeight(bx2, bz2), 2 * ahead) * 180) /
    Math.PI;

  return {
    position: [x, pivotY, z],
    yaw,
    pitch,
    roll,
    left,
    right,
    gradeDeg,
  };
}

// --- Steering ----------------------------------------------------------------

/** Longitudinal distance from the middle axle to the corner axles. */
export const CORNER_ARM = Math.abs(GEO.zMiddle - GEO.zFront);

/**
 * How fast the corner steering actuators can slew, radians per second.
 *
 * The real ones are slow enough that a turn-in-place manoeuvre is: stop, spend
 * a few seconds repositioning all four corners, then rotate. Snapping them
 * instantly is the single most artificial thing a rover sim can do.
 */
export const CORNER_SLEW_RATE = 1.8;

export interface SteerAngles {
  /** [frontLeft, frontRight, rearLeft, rearRight], radians. */
  corners: [number, number, number, number];
}

/**
 * Ackermann angles for a turn of the given curvature (1/radius, m^-1).
 * The rear corners steer opposite the front, which is what lets a six-wheeler
 * turn far tighter than a car of the same wheelbase.
 */
export function steerFor(curvature: number): SteerAngles {
  if (Math.abs(curvature) < 1e-5) return { corners: [0, 0, 0, 0] };

  const radius = 1 / curvature;
  const inner = Math.atan(CORNER_ARM / (Math.abs(radius) - GEO.halfTrack));
  const outer = Math.atan(CORNER_ARM / (Math.abs(radius) + GEO.halfTrack));
  const sign = Math.sign(curvature);

  // Turning left (positive curvature): left wheels are inner.
  const fl = sign > 0 ? inner : -outer;
  const fr = sign > 0 ? outer : -inner;
  return { corners: [fl, fr, -fl, -fr] };
}

/** Corner angles for turning in place: all four tangent to the same circle. */
export function steerTurnInPlace(): SteerAngles {
  const a = Math.atan2(CORNER_ARM, GEO.halfTrack);
  return { corners: [-a, a, a, -a] };
}

/**
 * Per-wheel motor current in amps.
 *
 * Not a real motor model — a plausible one. It tracks grade, articulation and
 * speed so the HUD needle moves for reasons you can see out the window.
 */
export function wheelCurrent(
  speed: number,
  gradeDeg: number,
  articulation: number,
  seed: number
): number {
  const idle = 0.35;
  const rolling = Math.abs(speed) * 0.22;
  const climbing = Math.max(0, gradeDeg) * 0.055;
  const digging = Math.max(0, -gradeDeg) * 0.012;
  const flex = Math.abs(articulation) * 1.4;
  const jitter = Math.sin(seed * 12.9898) * 0.04;
  return Math.max(0, idle + rolling + climbing + digging + flex + jitter);
}
