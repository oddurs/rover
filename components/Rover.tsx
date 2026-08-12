"use client";

import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { FlightModel } from "@/components/FlightModel";
import {
  type DriveContext,
  type DriveInput,
  createDriveState,
  resetDrive,
  stepArcade,
  stepSim,
} from "@/lib/drive";
import { MAST_LIMITS, MAST_SLEW_RATE, mast, mounts } from "@/lib/mounts";
import { initialYaw } from "@/lib/params";
import {
  CORNER_ARM,
  CORNER_SLEW_RATE,
  GEO,
  WHEEL_STATIONS,
  solvePose,
  steerFor,
  steerTurnInPlace,
  wheelCurrent,
} from "@/lib/rover";
import {
  buildHgaGeometry,
  buildMastHeadGeometry,
  buildRtgGeometry,
  buildWheelGeometry,
  strut,
} from "@/lib/roverGeometry";
import { telemetry, useUi } from "@/lib/store";
import { sampleHeight } from "@/lib/terrain";
import { VEHICLES } from "@/lib/vehicles";
import { shared } from "@/lib/uniforms";

/**
 * The rover's local origin sits in the plane of the two rocker pivots, which
 * is where the differential bar lives and therefore what the chassis pitches
 * about. Everything below is measured from there.
 */
const PIVOT_Y = GEO.rockerPivot.y;

const ROCKER_ORIGIN = { y: 0, z: GEO.rockerPivot.z };
const AXLE_Y = GEO.wheelRadius - PIVOT_Y;
const BOGIE_Y = GEO.bogiePivot.y - PIVOT_Y;

// Joint positions relative to their parent joint.
const FRONT_REL: [number, number, number] = [0, AXLE_Y, GEO.zFront - ROCKER_ORIGIN.z];
const BOGIE_REL: [number, number, number] = [
  0,
  BOGIE_Y,
  GEO.bogiePivot.z - ROCKER_ORIGIN.z,
];
const MIDDLE_REL: [number, number, number] = [
  0,
  AXLE_Y - BOGIE_Y,
  GEO.zMiddle - GEO.bogiePivot.z,
];
const REAR_REL: [number, number, number] = [
  0,
  AXLE_Y - BOGIE_Y,
  GEO.zRear - GEO.bogiePivot.z,
];

/** Tightest turn the corner actuators allow, metres. */
const MIN_TURN_RADIUS = 3.0;
/** Weight transfer, radians per m/s^2. Small: the suspension is very stiff. */
const PITCH_PER_G = 0.016;
const ROLL_PER_G = 0.010;
/** How quickly the body settles after a change in load. */
const BODY_TAU = 0.16;
/** Baseline for measuring crest curvature, metres. Matches lib/drive.ts. */
const LAUNCH_PROBE = 2.6;

/** Keep the rover where float32 world coordinates stay sub-centimetre. */
const ROAM_LIMIT = 15000;

interface Keys {
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
  boost: boolean;
  drift: boolean;
}

const KEY_MAP: Record<string, keyof Keys> = {
  KeyW: "fwd",
  ArrowUp: "fwd",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "brake",
  ShiftLeft: "boost",
  ShiftRight: "boost",
  KeyX: "drift",
};

function useKeys(edgeRef: React.RefObject<{ jump: boolean }>) {
  const keys = useRef<Keys>({
    fwd: false,
    back: false,
    left: false,
    right: false,
    brake: false,
    boost: false,
    drift: false,
  });

  useEffect(() => {
    const set = (e: KeyboardEvent, v: boolean) => {
      const k = KEY_MAP[e.code];
      if (!k) return;
      if (e.code === "Space") {
        e.preventDefault();
        // Latch the press so a quick tap survives even a slow frame.
        if (v && !keys.current.brake) edgeRef.current.jump = true;
      }
      keys.current[k] = v;
    };
    const down = (e: KeyboardEvent) => set(e, true);
    const up = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // edgeRef is a ref: stable for the life of the component, and re-binding
    // the listeners on it would drop key state mid-press.
  }, [edgeRef]);

  return keys;
}

function useMaterials() {
  return useMemo(() => {
    const m = (color: string, metalness: number, roughness: number) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness });
    return {
      // Gold multi-layer insulation — the blanketing that keeps the avionics
      // from freezing solid through a -80 C night.
      foil: m("#c9a052", 0.92, 0.28),
      // White radiator panels. The real rover is far lighter than most
      // renders suggest, which is what makes it read against dark basalt.
      hull: m("#ded9cf", 0.28, 0.52),
      deck: m("#a9a49a", 0.55, 0.45),
      dark: m("#232120", 0.35, 0.68),
      metal: m("#a3a099", 0.88, 0.3),
      wheel: m("#9d9890", 0.62, 0.45),
      lens: m("#0e1218", 0.5, 0.12),
    };
  }, []);
}

type Materials = ReturnType<typeof useMaterials>;

// --- Sub-assemblies ----------------------------------------------------------

function Wheel({
  geometry,
  materials,
  name,
  tag,
  steerName,
}: {
  geometry: THREE.BufferGeometry;
  materials: Materials;
  name: string;
  tag: string;
  steerName?: string;
}) {
  const body = (
    <group name={name} userData={{ wheel: tag }}>
      <mesh geometry={geometry} material={materials.wheel} castShadow receiveShadow />
    </group>
  );

  if (!steerName) return body;

  return (
    <group name={steerName}>
      {/* Steering actuator housing above each corner wheel. */}
      <mesh position={[0, 0.2, 0]} material={materials.dark} castShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.16, 12]} />
      </mesh>
      {body}
    </group>
  );
}

/**
 * One side of the suspension. Groups are addressed by name rather than by
 * ref so the whole linkage can be resolved once after mount.
 */
function Side({
  side,
  materials,
  wheelGeo,
}: {
  side: -1 | 1;
  materials: Materials;
  wheelGeo: THREE.BufferGeometry;
}) {
  const s = side < 0 ? "L" : "R";

  const rockerArms = useMemo(
    () => [
      strut([0, 0, 0], FRONT_REL, 0.042),
      strut([0, 0, 0], BOGIE_REL, 0.042),
      strut([0, 0.08, -0.1], [0, 0.08, 0.12], 0.05),
    ],
    []
  );
  const bogieArms = useMemo(
    () => [strut([0, 0, 0], MIDDLE_REL, 0.036), strut([0, 0, 0], REAR_REL, 0.036)],
    []
  );

  return (
    <group position={[side * GEO.halfTrack, ROCKER_ORIGIN.y, ROCKER_ORIGIN.z]}>
      <group name={`${s}.rocker`}>
        {rockerArms.map((g, i) => (
          <mesh key={i} geometry={g} material={materials.metal} castShadow />
        ))}

        <group position={FRONT_REL}>
          <Wheel
            geometry={wheelGeo}
            materials={materials}
            name={`${s}.spin0`}
            steerName={`${s}.steer0`}
            tag={`${s}F`}
          />
        </group>

        <group position={BOGIE_REL}>
          <group name={`${s}.bogie`}>
            {bogieArms.map((g, i) => (
              <mesh key={i} geometry={g} material={materials.metal} castShadow />
            ))}
            <group position={MIDDLE_REL}>
              <Wheel
                geometry={wheelGeo}
                materials={materials}
                name={`${s}.spin1`}
                tag={`${s}M`}
              />
            </group>
            <group position={REAR_REL}>
              <Wheel
                geometry={wheelGeo}
                materials={materials}
                name={`${s}.spin2`}
                steerName={`${s}.steer1`}
                tag={`${s}R`}
              />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

// --- The rover ---------------------------------------------------------------

export function Rover() {
  const materials = useMaterials();
  const wheelGeo = useMemo(() => buildWheelGeometry(), []);
  const rtgGeo = useMemo(() => buildRtgGeometry(), []);
  const mastHeadGeo = useMemo(() => buildMastHeadGeometry(), []);
  const hgaGeo = useMemo(() => buildHgaGeometry(), []);

  const armGeo = useMemo(() => {
    // Stowed against the front bumper, the way it rides between targets.
    const shoulder: [number, number, number] = [0.3, -0.05, -0.92];
    const elbow: [number, number, number] = [0.34, -0.3, -1.34];
    const wrist: [number, number, number] = [-0.1, -0.33, -1.36];
    return [
      strut(shoulder, elbow, 0.05),
      strut(elbow, wrist, 0.045),
      strut(wrist, [-0.3, -0.33, -1.18], 0.04),
    ];
  }, []);

  const landEuler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);
  const landQuat = useMemo(() => new THREE.Quaternion(), []);
  const root = useRef<THREE.Group>(null);
  const joints = useRef<Map<string, THREE.Object3D>>(new Map());
  const edge = useRef({ jump: false });
  const keys = useKeys(edge);
  const modelKind = useUi((s) => s.modelKind);

  const drive = useRef({
    ...createDriveState(initialYaw()),
    /** Commanded steering, -1..1, before the actuators get to it. */
    steer: 0,
    /** Actual corner angles: [frontL, frontR, rearL, rearR]. */
    corners: [0, 0, 0, 0],
    /** Rolled angle per wheel: L front/mid/rear then R front/mid/rear. */
    spin: [0, 0, 0, 0, 0, 0],
    pitchBias: 0,
    rollBias: 0,
    prevSpeed: 0,
    prevRockerL: 0,
    prevRockerR: 0,
    prevPitch: 0,
    prevRoll: 0,
    pitchRateNow: 0,
    rollRateNow: 0,
    prevPoseY: 0,
    groundVy: 0,
    groundAccelY: 0,
    pitchAccelNow: 0,
    rollAccelNow: 0,
    prevMode: "" as string,
    seenReset: 0,
    rescan: 0,
    /** Last measured grade, fed back into the slip model. */
    grade: 0,
  });

  // Resolve the articulating groups by name. Re-run periodically as well as
  // on mount, because the flight model streams in behind Suspense and swaps
  // the whole rig out from under us.
  const rescan = () => {
    const r = root.current;
    if (!r) return;
    const map = joints.current;
    map.clear();
    r.traverse((o) => {
      if (o.name) map.set(o.name, o);
    });
    mounts.mastHead = map.get("mastHead") ?? null;
    mounts.chassis = map.get("chassis") ?? null;
  };

  useEffect(() => {
    const r = root.current;
    if (!r) return;
    mounts.root = r;
    rescan();
    return () => {
      mounts.root = null;
      mounts.mastHead = null;
      mounts.chassis = null;
    };
  }, [modelKind]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const d = drive.current;
    const k = keys.current;
    const j = joints.current;
    d.rescan = (d.rescan + 1) % 15;
    if (d.rescan === 0) rescan();

    const ui = useUi.getState();
    const arcade = ui.mode === "arcade";

    const input: DriveInput = {
      throttle: (k.fwd ? 1 : 0) - (k.back ? 1 : 0),
      steer: (k.left ? 1 : 0) - (k.right ? 1 : 0),
      // Space brakes a rover and launches an arcade machine.
      brake: !arcade && k.brake,
      jump: arcade && k.brake,
      jumpPressed: arcade && edge.current.jump,
      boost: k.boost,
      drift: arcade && k.drift,
      reset: false,
    };

    // Switching models must not carry speed across. Arcade cruises at 15 m/s;
    // handing that to the simulation, which then multiplies by the time
    // compression, launches the rover across the crater.
    if (d.prevMode && d.prevMode !== ui.mode) resetDrive(d);
    d.prevMode = ui.mode;

    if (ui.resetNonce !== d.seenReset) {
      d.seenReset = ui.resetNonce;
      input.reset = true;
    }

    // Where the corners are being asked to point.
    const turningInPlace =
      !arcade && input.throttle === 0 && input.steer !== 0 && Math.abs(d.vFwd) < 0.004;

    let target: [number, number, number, number];
    if (turningInPlace) {
      target = steerTurnInPlace().corners;
    } else if (arcade) {
      d.steer += THREE.MathUtils.clamp(input.steer - d.steer, -6 * dt, 6 * dt);
      target = steerFor(d.steer / MIN_TURN_RADIUS).corners;
    } else {
      d.steer += THREE.MathUtils.clamp(input.steer - d.steer, -2.6 * dt, 2.6 * dt);
      target = steerFor(d.steer / MIN_TURN_RADIUS).corners;
    }

    // Slew the actuators. Everything downstream uses where the wheels have
    // actually got to, not where they were told to go.
    const slew = (arcade ? 6 : 1) * CORNER_SLEW_RATE;
    let misalign = 0;
    for (let i = 0; i < 4; i++) {
      const step = THREE.MathUtils.clamp(target[i] - d.corners[i], -slew * dt, slew * dt);
      d.corners[i] += step;
      misalign = Math.max(misalign, Math.abs(target[i] - d.corners[i]));
    }
    const corners = d.corners as [number, number, number, number];
    const aligned = THREE.MathUtils.clamp(1 - misalign / 0.4, 0, 1);

    // Curvature of the ground along the heading, measured over a
    // suspension-scale baseline: the linkage swallows anything shorter than
    // the vehicle, so the body follows a low-passed version of the terrain.
    const fx = -Math.sin(d.yaw);
    const fz = -Math.cos(d.yaw);
    const P = LAUNCH_PROBE;
    const hHere = sampleHeight(d.x, d.z);
    const hAhead = sampleHeight(d.x + fx * P, d.z + fz * P);
    const hBehind = sampleHeight(d.x - fx * P, d.z - fz * P);
    // Positive over a crest.
    const convexity = -(hBehind - 2 * hHere + hAhead) / (P * P);
    const riseRate = (hHere - hBehind) / P;

    const ctx: DriveContext = {
      gradeDeg: d.grade,
      convexity,
      riseRate,
      timeCompression: ui.timeCompression,
      frontAngle: (corners[0] + corners[1]) / 2,
      cornerArm: CORNER_ARM,
      turningInPlace,
      aligned,
      pitch: d.prevPitch,
      roll: d.prevRoll,
      pitchRate: d.pitchRateNow,
      rollRate: d.rollRateNow,
      groundAccelY: d.groundAccelY,
      pitchAccel: d.pitchAccelNow,
      rollAccel: d.rollAccelNow,
    };

    edge.current.jump = false;

    // Inspection hook: the drive state and the live input, for probing.
    const dbg = (window as unknown as { rover?: Record<string, unknown> }).rover;
    if (dbg) {
      dbg.drive = d;
      dbg.input = input;
      dbg.mast = mast;
    }

    if (arcade) stepArcade(d, input, dt, ctx);
    else stepSim(d, input, dt, ctx);

    const yawRate = d.yawRate;

    // Keep inside the region where float32 world coordinates stay precise.
    d.x = THREE.MathUtils.clamp(d.x, -ROAM_LIMIT, ROAM_LIMIT);
    d.z = THREE.MathUtils.clamp(d.z, -ROAM_LIMIT, ROAM_LIMIT);

    // Per-wheel rolling, from each wheel's own ground velocity.
    //
    // A wheel's velocity is the hull's plus the yaw rate crossed with its
    // offset, so the outside of a turn covers more ground than the inside and
    // in a turn-in-place the two sides roll in opposite directions. Projecting
    // that onto the wheel's steered heading gives how fast it actually rolls.
    //
    // The sign is negative because rotating a wheel group by +X carries its
    // contact patch toward -Z, and rolling forward needs it going the other way.
    // Wheels turn at the *commanded* rate even when the ground refuses to
    // cooperate, which is what makes slip and drift visible from outside.
    const steerPerWheel = [corners[0], 0, corners[2], corners[1], 0, corners[3]];
    const spinDt = arcade ? dt : dt * ui.timeCompression;
    for (let i = 0; i < 6; i++) {
      const [wx, wz] = WHEEL_STATIONS[i];
      const vx = yawRate * wz;
      const vz = -d.wheelSpeed - yawRate * wx;
      const delta = steerPerWheel[i];
      const rolling = -Math.sin(delta) * vx - Math.cos(delta) * vz;
      d.spin[i] -= (rolling / GEO.wheelRadius) * spinDt;
    }

    const pose = solvePose(d.x, d.z, d.yaw, modelKind !== "engineering");
    d.grade = pose.gradeDeg;
    // How fast the terrain is currently rotating the hull. A rover that drives
    // off a crest keeps rotating the way the crest was rotating it.
    if (dt > 1e-6) {
      const pr = (pose.pitch - d.prevPitch) / dt;
      const rr = (pose.roll - d.prevRoll) / dt;
      d.pitchAccelNow = (pr - d.pitchRateNow) / dt;
      d.rollAccelNow = (rr - d.rollRateNow) / dt;
      d.pitchRateNow = pr;
      d.rollRateNow = rr;

      // How hard the ground is throwing the hull up or dropping it away.
      // Lightly smoothed: a raw second difference of a noisy surface at a
      // variable frame rate is all spikes.
      const vy = (pose.position[1] - d.prevPoseY) / dt;
      const smoothed = d.groundVy + (vy - d.groundVy) * 0.35;
      d.groundAccelY = (smoothed - d.groundVy) / dt;
      d.groundVy = smoothed;
    }
    d.prevPitch = pose.pitch;
    d.prevRoll = pose.roll;
    d.prevPoseY = pose.position[1];

    // Weight transfer. Accelerating lifts the nose, braking drops it, and a
    // turn leans the body outward. Tiny — the linkage is stiff and the vehicle
    // is slow — but its absence is what makes a rover feel like it is sliding
    // rather than driving.
    // Guard the divide: R3F can hand us a zero delta, and a single NaN here
    // poisons the bias permanently, which takes the whole chassis matrix with it.
    const along = dt > 1e-6 ? (d.vFwd - d.prevSpeed) / dt : 0;
    d.prevSpeed = d.vFwd;
    const settle = 1 - Math.exp(-dt / BODY_TAU);
    d.pitchBias +=
      (THREE.MathUtils.clamp(along * PITCH_PER_G, -0.05, 0.05) - d.pitchBias) * settle;
    d.rollBias +=
      (THREE.MathUtils.clamp(-d.vFwd * yawRate * ROLL_PER_G, -0.05, 0.05) - d.rollBias) *
      settle;

    // In flight or on its back the body carries its own orientation; on the
    // wheels the terrain decides it. Just after touchdown it is easing from
    // one to the other, and during that hand-over the whole attitude lives on
    // the root so the two can be interpolated as a single rotation.
    const freeBody = d.airborne || d.crashed;
    const settling = !freeBody && d.landBlend > 0;

    // What the ground is asking for, spring included.
    const gPitch = pose.pitch + d.pitchBias + d.suspPitch;
    const gRoll = pose.roll + d.rollBias + d.suspRoll;

    if (root.current) {
      root.current.position.set(
        pose.position[0],
        pose.position[1] + d.airY - d.compress - d.suspY + (d.crashed ? 0.3 : 0),
        pose.position[2]
      );
      if (freeBody) {
        root.current.quaternion.copy(d.quat);
      } else if (settling) {
        landEuler.set(gPitch, d.yaw, gRoll, "YXZ");
        landQuat.setFromEuler(landEuler);
        root.current.quaternion.copy(landQuat).slerp(d.landQuat, d.landBlend);
      } else {
        root.current.rotation.set(0, d.yaw, 0);
      }
    }
    const chassis = j.get("chassis");
    if (chassis) {
      // Zero while the root owns the full attitude, or it would be applied twice.
      chassis.rotation.x = freeBody || settling ? 0 : gPitch;
      chassis.rotation.z = freeBody || settling ? 0 : gRoll;
    }

    // Linkage angles are absolute; each joint renders relative to its parent,
    // so subtract whatever the parent already contributes.
    const avgRocker = (pose.left.rockerAngle + pose.right.rockerAngle) / 2;
    const sides = [
      ["L", pose.left],
      ["R", pose.right],
    ] as const;
    for (let side = 0; side < 2; side++) {
      const [s, sol] = sides[side];
      const rocker = j.get(`${s}.rocker`);
      if (rocker) rocker.rotation.x = avgRocker - sol.rockerAngle;
      const bogie = j.get(`${s}.bogie`);
      if (bogie) bogie.rotation.x = sol.rockerAngle - sol.bogieAngle;
      for (let i = 0; i < 3; i++) {
        const w = j.get(`${s}.spin${i}`);
        if (w) w.rotation.x = d.spin[side * 3 + i];
      }
    }

    // corners: [frontLeft, frontRight, rearLeft, rearRight]
    const steerNames = ["L.steer0", "R.steer0", "L.steer1", "R.steer1"];
    for (let i = 0; i < 4; i++) {
      const o = j.get(steerNames[i]);
      if (o) o.rotation.y = corners[i];
    }

    // Slew toward a commanded target, if one has been set by clicking.
    if (mast.slewing) {
      const dp = THREE.MathUtils.clamp(
        mast.targetPan - mast.pan, -MAST_SLEW_RATE * dt, MAST_SLEW_RATE * dt
      );
      const dtl = THREE.MathUtils.clamp(
        mast.targetTilt - mast.tilt, -MAST_SLEW_RATE * dt, MAST_SLEW_RATE * dt
      );
      mast.pan += dp;
      mast.tilt = THREE.MathUtils.clamp(
        mast.tilt + dtl, MAST_LIMITS.tiltMin, MAST_LIMITS.tiltMax
      );
      if (Math.abs(mast.targetPan - mast.pan) < 1e-3 &&
          Math.abs(mast.targetTilt - mast.tilt) < 1e-3) {
        mast.slewing = false;
      }
    }

    // The mast is what actually aims; the camera just rides on the head.
    const head = j.get("mastHead");
    if (head) head.rotation.set(mast.tilt, mast.pan, 0, "YXZ");

    // Terrain LOD follows the rover.
    shared.uFocus.value.set(d.x, d.z);

    // --- telemetry ---
    const artL = (pose.left.rockerAngle - d.prevRockerL) / dt;
    const artR = (pose.right.rockerAngle - d.prevRockerR) / dt;
    d.prevRockerL = pose.left.rockerAngle;
    d.prevRockerR = pose.right.rockerAngle;

    telemetry.x = d.x;
    telemetry.z = d.z;
    telemetry.elevation = pose.position[1] - PIVOT_Y;
    telemetry.yaw = d.yaw;
    telemetry.pitch = pose.pitch;
    telemetry.roll = pose.roll;
    telemetry.grade = pose.gradeDeg;
    telemetry.speed = d.vFwd;
    telemetry.odometer = d.odometer;
    telemetry.trueOdometer = d.trueOdometer;
    telemetry.slip = d.slip;
    telemetry.battery = d.battery;
    telemetry.airborne = d.airborne;
    telemetry.airY = d.airY;
    telemetry.airtime = d.airtime;
    telemetry.drifting = d.drifting;
    telemetry.crashed = d.crashed;
    telemetry.crouching = d.crouching;
    telemetry.lateral = d.vLat;
    telemetry.rockerLeft = pose.left.rockerAngle;
    telemetry.rockerRight = pose.right.rockerAngle;
    telemetry.bogieLeft = pose.left.bogieAngle;
    telemetry.bogieRight = pose.right.bogieAngle;
    for (let i = 0; i < 6; i++) {
      telemetry.currents[i] = wheelCurrent(
        // The current model is scaled for a rover doing centimetres a second;
        // arcade speeds would peg every bar.
        arcade ? d.vFwd * 0.02 : d.vFwd,
        pose.gradeDeg,
        i < 3 ? artL : artR,
        d.odometer + i * 3.1
      );
    }
  });

  return (
    <group ref={root}>
      <group name="chassis">
        {modelKind !== "engineering" ? (
          <Suspense fallback={null}>
            <FlightModel vehicle={VEHICLES[modelKind]} />
          </Suspense>
        ) : (
          <>
        {/* Warm electronics box: the insulated hull carrying the avionics. */}
        <mesh position={[0, 0.26, 0.06]} material={materials.hull} castShadow receiveShadow>
          <boxGeometry args={[1.26, 0.58, 1.82]} />
        </mesh>
        {/* Sloped front face, which is what gives the rover its stance. */}
        <mesh
          position={[0, 0.13, -0.94]}
          rotation={[0.62, 0, 0]}
          material={materials.hull}
          castShadow
        >
          <boxGeometry args={[1.26, 0.44, 0.3]} />
        </mesh>

        {/* Gold insulation down both flanks. */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.638, 0.24, 0.06]} material={materials.foil} castShadow>
            <boxGeometry args={[0.025, 0.44, 1.66]} />
          </mesh>
        ))}

        {/* Equipment deck and the avionics boxes bolted to it. */}
        <mesh position={[0, 0.565, 0.05]} material={materials.deck} castShadow receiveShadow>
          <boxGeometry args={[1.32, 0.05, 1.92]} />
        </mesh>
        <mesh position={[0.24, 0.65, -0.28]} material={materials.hull} castShadow>
          <boxGeometry args={[0.42, 0.14, 0.5]} />
        </mesh>
        <mesh position={[-0.3, 0.63, 0.38]} material={materials.foil} castShadow>
          <boxGeometry args={[0.34, 0.11, 0.44]} />
        </mesh>

        {/* Belly pan. */}
        <mesh position={[0, -0.05, 0.06]} material={materials.dark} castShadow>
          <boxGeometry args={[1.16, 0.06, 1.72]} />
        </mesh>

        {/* Hazcams: stereo pairs low at each end, for autonomous driving. */}
        {[-1, 1].map((s) =>
          [-1.06, 1.0].map((z) => (
            <mesh
              key={`${s}${z}`}
              position={[s * 0.3, -0.02, z]}
              material={materials.lens}
              castShadow
            >
              <boxGeometry args={[0.13, 0.07, 0.06]} />
            </mesh>
          ))
        )}

        {/* RTG on its bracket, cantilevered off the back and tilted up.
            Plutonium heat rather than sunlight, which is why dust storms
            don't end this mission the way one ended Opportunity's. */}
        <mesh position={[0, 0.44, 1.02]} material={materials.metal} castShadow>
          <boxGeometry args={[0.5, 0.1, 0.3]} />
        </mesh>
        <group position={[0, 0.5, 1.36]} rotation={[-0.3, 0, 0]}>
          <mesh geometry={rtgGeo} material={materials.metal} castShadow />
        </group>

        {/* Remote sensing mast. */}
        <group position={[-0.4, 0.59, -0.68]}>
          <mesh position={[0, 0.2, 0]} material={materials.dark} castShadow>
            <cylinderGeometry args={[0.085, 0.1, 0.16, 12]} />
          </mesh>
          <mesh position={[0, 0.5, 0]} material={materials.hull} castShadow>
            <cylinderGeometry args={[0.05, 0.062, 0.62, 12]} />
          </mesh>
          {/* Weather station booms jutting off the mast. */}
          {[0.9, 2.3].map((a, i) => (
            <mesh
              key={i}
              position={[Math.sin(a) * 0.17, 0.66, Math.cos(a) * 0.17]}
              rotation={[0, -a, Math.PI / 2]}
              material={materials.metal}
              castShadow
            >
              <cylinderGeometry args={[0.014, 0.014, 0.3, 8]} />
            </mesh>
          ))}
          <group name="mastHead" position={[0, 0.85, 0]}>
            <mesh geometry={mastHeadGeo} material={materials.hull} castShadow />
            {/* Lens glass, so the cameras read as cameras. */}
            {[-0.17, 0.17].map((x) => (
              <mesh key={x} position={[x, 0, -0.152]} material={materials.lens}>
                <cylinderGeometry args={[0.042, 0.042, 0.012, 14]} />
              </mesh>
            ))}
            {[-0.06, 0.06].map((x) => (
              <mesh key={`n${x}`} position={[x, 0.035, -0.128]} material={materials.lens}>
                <cylinderGeometry args={[0.027, 0.027, 0.012, 12]} />
              </mesh>
            ))}
          </group>
        </group>

        {/* High-gain antenna, pointed at Earth. */}
        <group position={[0.45, 0.59, 0.46]} rotation={[0, -0.5, 0]}>
          <mesh geometry={hgaGeo} material={materials.hull} castShadow />
        </group>

        {/* UHF antenna — the one that actually carries the data home, by
            relaying through whichever orbiter is overhead. */}
        <mesh position={[0.34, 0.76, 0.86]} material={materials.dark} castShadow>
          <cylinderGeometry args={[0.038, 0.05, 0.36, 10]} />
        </mesh>

        {/* Robotic arm, stowed. */}
        {armGeo.map((g, i) => (
          <mesh key={i} geometry={g} material={materials.metal} castShadow />
        ))}
        <mesh
          position={[-0.3, -0.33, -1.18]}
          rotation={[Math.PI / 2, 0, 0]}
          material={materials.dark}
          castShadow
        >
          <cylinderGeometry args={[0.12, 0.12, 0.2, 14]} />
        </mesh>

        <Side side={-1} materials={materials} wheelGeo={wheelGeo} />
        <Side side={1} materials={materials} wheelGeo={wheelGeo} />
          </>
        )}
      </group>
    </group>
  );
}
