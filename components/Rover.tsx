"use client";

import { useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { FlightModel } from "@/components/FlightModel";
import { MARS } from "@/lib/mars";
import { mast, mounts } from "@/lib/mounts";
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
const TURN_IN_PLACE_RATE = 0.42; // rad/s at the default speed multiplier
const ACCEL = 2.4; // m/s^2 in sim-time — a two-tonne vehicle, not a go-kart
/** Weight transfer, radians per m/s^2. Small: the suspension is very stiff. */
const PITCH_PER_G = 0.016;
const ROLL_PER_G = 0.010;
/** How quickly the body settles after a change in load. */
const BODY_TAU = 0.16;
/** Keep the rover where float32 world coordinates stay sub-centimetre. */
const ROAM_LIMIT = 15000;

interface Keys {
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
  boost: boolean;
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
};

function useKeys() {
  const keys = useRef<Keys>({
    fwd: false,
    back: false,
    left: false,
    right: false,
    brake: false,
    boost: false,
  });

  useEffect(() => {
    const set = (e: KeyboardEvent, v: boolean) => {
      const k = KEY_MAP[e.code];
      if (!k) return;
      if (e.code === "Space") e.preventDefault();
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
  }, []);

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

  const root = useRef<THREE.Group>(null);
  const joints = useRef<Map<string, THREE.Object3D>>(new Map());
  const keys = useKeys();
  const modelKind = useUi((s) => s.modelKind);

  const drive = useRef({
    x: 0,
    z: 0,
    yaw: initialYaw(),
    speed: 0,
    prevSpeed: 0,
    steer: 0,
    /** Actual corner angles: [frontL, frontR, rearL, rearR]. */
    corners: [0, 0, 0, 0],
    /** Rolled angle per wheel: L front/mid/rear then R front/mid/rear. */
    spin: [0, 0, 0, 0, 0, 0],
    pitchBias: 0,
    rollBias: 0,
    odometer: 0,
    prevRockerL: 0,
    prevRockerR: 0,
    rescan: 0,
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
    const { speedScale } = useUi.getState();

    d.rescan = (d.rescan + 1) % 15;
    if (d.rescan === 0) rescan();

    const throttle = (k.fwd ? 1 : 0) - (k.back ? 1 : 0);
    const steerIn = (k.left ? 1 : 0) - (k.right ? 1 : 0);

    const topSpeed = MARS.roverTopSpeed * speedScale * (k.boost ? 2.5 : 1);
    const accel = ACCEL * (k.boost ? 2 : 1);
    d.speed += THREE.MathUtils.clamp(throttle * topSpeed - d.speed, -accel * dt, accel * dt);
    if (k.brake) d.speed *= Math.pow(0.015, dt);

    // With no throttle, steering input spins the rover about its own centre —
    // the manoeuvre four independently steered corners exist to make possible.
    const turningInPlace = throttle === 0 && steerIn !== 0 && Math.abs(d.speed) < 0.35;

    // What the corners are being *asked* for.
    let target: [number, number, number, number];
    if (turningInPlace) {
      d.speed *= Math.pow(0.02, dt);
      target = steerTurnInPlace().corners;
    } else {
      d.steer += THREE.MathUtils.clamp(steerIn - d.steer, -2.6 * dt, 2.6 * dt);
      // Tighten the achievable radius off at speed, the way any real vehicle
      // has to. Full lock is only available when crawling.
      const speedFrac = Math.min(1, Math.abs(d.speed) / Math.max(topSpeed, 0.001));
      target = steerFor((d.steer / MIN_TURN_RADIUS) * (1 - 0.45 * speedFrac)).corners;
    }

    // Slew the actuators toward it. Everything downstream uses where the
    // wheels have actually got to, not where they were told to go.
    let misalign = 0;
    for (let i = 0; i < 4; i++) {
      const step = THREE.MathUtils.clamp(
        target[i] - d.corners[i],
        -CORNER_SLEW_RATE * dt,
        CORNER_SLEW_RATE * dt
      );
      d.corners[i] += step;
      misalign = Math.max(misalign, Math.abs(target[i] - d.corners[i]));
    }
    const corners = d.corners as [number, number, number, number];
    // Wheels still slewing can't put much force into the ground yet.
    const aligned = THREE.MathUtils.clamp(1 - misalign / 0.4, 0, 1);

    let yawRate: number;
    if (turningInPlace) {
      yawRate = steerIn * TURN_IN_PLACE_RATE * (speedScale / 120) * aligned;
    } else {
      // Recover the curvature the front pair is genuinely set up for, so the
      // hull only starts to come round once the wheels have.
      yawRate = (d.speed * Math.tan((corners[0] + corners[1]) / 2)) / CORNER_ARM;
    }
    d.yaw += yawRate * dt;

    // Per-wheel rolling, from each wheel's own ground velocity.
    //
    // A wheel's velocity is the hull's plus the yaw rate crossed with its
    // offset, so the outside of a turn covers more ground than the inside and
    // in a turn-in-place the two sides roll in opposite directions. Projecting
    // that onto the wheel's steered heading gives how fast it actually rolls.
    //
    // The sign is negative because rotating a wheel group by +X carries its
    // contact patch toward -Z, and rolling forward needs it going the other way.
    const steerPerWheel = [corners[0], 0, corners[2], corners[1], 0, corners[3]];
    for (let i = 0; i < 6; i++) {
      const [wx, wz] = WHEEL_STATIONS[i];
      const vx = yawRate * wz;
      const vz = -d.speed - yawRate * wx;
      const delta = steerPerWheel[i];
      const rolling = -Math.sin(delta) * vx - Math.cos(delta) * vz;
      d.spin[i] -= (rolling / GEO.wheelRadius) * dt;
    }

    d.x = THREE.MathUtils.clamp(
      d.x - Math.sin(d.yaw) * d.speed * dt,
      -ROAM_LIMIT,
      ROAM_LIMIT
    );
    d.z = THREE.MathUtils.clamp(
      d.z - Math.cos(d.yaw) * d.speed * dt,
      -ROAM_LIMIT,
      ROAM_LIMIT
    );
    d.odometer += Math.abs(d.speed) * dt;

    const pose = solvePose(d.x, d.z, d.yaw, modelKind === "flight");

    // Weight transfer. Accelerating lifts the nose, braking drops it, and a
    // turn leans the body outward. Tiny — the linkage is stiff and the vehicle
    // is slow — but its absence is what makes a rover feel like it is sliding
    // rather than driving.
    // Guard the divide: R3F can hand us a zero delta, and a single NaN here
    // poisons the bias permanently, which takes the whole chassis matrix with it.
    const along = dt > 1e-6 ? (d.speed - d.prevSpeed) / dt : 0;
    d.prevSpeed = d.speed;
    const settle = 1 - Math.exp(-dt / BODY_TAU);
    d.pitchBias +=
      (THREE.MathUtils.clamp(along * PITCH_PER_G, -0.05, 0.05) - d.pitchBias) * settle;
    d.rollBias +=
      (THREE.MathUtils.clamp(-d.speed * yawRate * ROLL_PER_G, -0.05, 0.05) - d.rollBias) *
      settle;

    if (root.current) {
      root.current.position.set(pose.position[0], pose.position[1], pose.position[2]);
      root.current.rotation.y = d.yaw;
    }
    const chassis = j.get("chassis");
    if (chassis) {
      chassis.rotation.x = pose.pitch + d.pitchBias;
      chassis.rotation.z = pose.roll + d.rollBias;
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
    telemetry.speed = d.speed;
    telemetry.odometer = d.odometer;
    telemetry.rockerLeft = pose.left.rockerAngle;
    telemetry.rockerRight = pose.right.rockerAngle;
    telemetry.bogieLeft = pose.left.bogieAngle;
    telemetry.bogieRight = pose.right.bogieAngle;
    for (let i = 0; i < 6; i++) {
      telemetry.currents[i] = wheelCurrent(
        d.speed,
        pose.gradeDeg,
        i < 3 ? artL : artR,
        d.odometer + i * 3.1
      );
    }
  });

  return (
    <group ref={root}>
      <group name="chassis">
        {modelKind === "flight" ? (
          <Suspense fallback={null}>
            <FlightModel />
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
