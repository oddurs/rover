/**
 * Two ways to move a rover.
 *
 * SIMULATION follows what Curiosity actually does. It drives at 4.2 cm/s, turns
 * in place at a rate that falls straight out of that speed and the wheel
 * geometry, slips on slopes, and runs off a battery the RTG can't refill fast
 * enough to drive continuously. Because 4.2 cm/s is unwatchable, the mode
 * compresses *time* rather than speeding up the vehicle: the clock, the sun and
 * the rover all run at the same multiple, so what you see is a time-lapse of a
 * real drive rather than a rover that has been made fast.
 *
 * ARCADE throws that out. Velocity is a vector rather than a path to follow, so
 * the thing can slide; Mars' 3.72 m/s^2 makes jumps hang absurdly long, which
 * is the single most fun thing about the setting and no simulator would let you
 * do it.
 */

import * as THREE from "three";

import { GEO } from "./rover";
import { MARS } from "./mars";

export type DriveMode = "sim" | "arcade";

// --- Simulation --------------------------------------------------------------

/**
 * Turn-in-place rate, rad/s. Not a guess: the corner wheels sit
 * hypot(halfTrack, cornerArm) from the centre, so at the rover's own top speed
 * the hull can only come round this fast. Works out at about 1.5 deg/s.
 */
export const SIM_TURN_RATE =
  MARS.roverTopSpeed / Math.hypot(GEO.halfTrack, Math.abs(GEO.zMiddle - GEO.zFront));

/** Drive actuators ramp over roughly a second. */
const SIM_ACCEL = 0.045;

/** MMRTG electrical output, watts. Steady, day and night, for years. */
export const RTG_WATTS = 110;
/** Mobility draw while driving, watts. */
const DRIVE_WATTS = 200;
/** Everything else — avionics, heaters, comms — averaged, watts. */
const HOTEL_WATTS = 90;
/** Two lithium-ion units, roughly 2.35 kWh together, in joules. */
export const BATTERY_JOULES = 2.35 * 3.6e6;

/**
 * Fraction of commanded motion lost to slip.
 *
 * Curiosity has seen slip past 50% on sandy slopes, and once lost most of a
 * sol's drive to it. Wheels keep turning at the commanded rate — which is what
 * makes slip visible from outside, and is why the odometry it reports and the
 * distance it has actually travelled are two different numbers.
 */
export function slipFraction(gradeDeg: number): number {
  if (gradeDeg <= 4) return 0;
  return Math.min(0.92, (gradeDeg - 4) / 34);
}

// --- Arcade ------------------------------------------------------------------

const ARCADE = {
  topSpeed: 15,
  boostSpeed: 27,
  accel: 16,
  brake: 26,
  /** Coast-down off the throttle, per second. */
  drag: 0.5,
  /**
   * How fast the velocity vector swings back into line with where the hull is
   * pointing. This is what grip *is*: high and the rover goes where it points,
   * low and it keeps going where it was already going while the nose comes
   * round — which is a drift.
   */
  grip: 5.5,
  handbrakeGrip: 0.5,
  /** The handbrake scrubs speed off as well as traction. */
  handbrakeDrag: 1.5,
  yawRate: 1.6,
  handbrakeYawBonus: 1.1,
  /** Launch speed, m/s. In Mars gravity this hangs for over three seconds. */
  jump: 6.6,
  hold: 5.0,
  holdTime: 0.35,
  /** Angular velocity bled off in flight, per second. */
  spinDamping: 0.55,
  /**
   * Nose-up kick on take-off, per m/s. Small on purpose: a three-second hang
   * multiplies any spin enormously, and at the first value every single jump
   * put the rover on its back. Landing wrong should be something the terrain
   * does to you, not the default outcome.
   */
  launchTip: 0.02,
  /** Ceiling on take-off spin, rad/s. */
  maxLaunchSpin: 1.1,
  /**
   * How far ahead and behind to measure the crest, metres.
   *
   * Wider than the wheelbase on purpose. The suspension swallows anything
   * shorter than the vehicle — that is what it is for — so the body follows a
   * low-passed version of the ground, and measuring the curvature over a
   * suspension-scale baseline is what decides whether the *body* flies.
   */
  launchProbe: 2.6,
  /** Ceiling on a bump launch, m/s. A crest should lift it, not fire it. */
  maxBumpVy: 3.2,
  /**
   * How far past the theoretical threshold a crest has to go before the body
   * actually flies. The suspension has real travel and real stored energy, so
   * it holds the hull down through the first part of a crest that bare
   * point-mass physics would already have thrown it off.
   */
  launchMargin: 1.7,
  /** Below this the wheels are still catching the ground often enough to steer. */
  skimHeight: 0.5,
  skimSteer: 0.55,
  skimThrottle: 0.45,
  /** A jump squats before it throws, the way legs do. */
  crouchTime: 0.16,
  crouchDepth: 0.17,
  /** Overshoot as the suspension unloads, m. Negative is extended. */
  extend: -0.12,
  /**
   * Landing spring. Stiffer and much better damped than the first attempt,
   * which was springy enough (zeta ~0.6) to pogo, and was given so much energy
   * that it slammed into its own travel limit and rebounded off the clamp.
   * At zeta ~0.85 it takes the load, overshoots once, and is done.
   */
  suspK: 150,
  suspC: 21,
  suspTravel: 0.3,
  /** Impact velocity converted into spring velocity. */
  suspTake: 0.62,
  suspMaxTake: 4.2,
  /** How hard a mismatched attitude rocks the hull, and its ceiling. */
  rockGain: 2.2,
  rockMax: 1.1,
  /**
   * Time constant for handing attitude back to the terrain after touchdown.
   * Without this the hull snaps from its flight orientation to the ground
   * solution in a single frame, which is most of what read as "volatile".
   */
  landBlendTau: 0.13,
  /**
   * Gentle self-righting in flight. The real vehicle has a low, heavy chassis
   * slung under its wheels, and it means an ordinary jump comes down on its
   * feet while a genuinely bad launch still doesn't.
   */
  righting: 1.5,
  /** Land steeper than this off vertical and it is a crash, radians. */
  crashAngle: 1.05,
} as const;

// --- State -------------------------------------------------------------------

export interface DriveState {
  x: number;
  z: number;
  yaw: number;
  /** Speed along the heading, m/s. Grounded bookkeeping and the HUD. */
  vFwd: number;
  /** Sideways speed, m/s — the slip that makes a drift a drift. */
  vLat: number;
  /** World velocity. Arcade integrates this directly so it can fly. */
  vel: THREE.Vector3;
  /** Height above the terrain, m. Zero unless airborne. */
  airY: number;
  airborne: boolean;
  airtime: number;
  jumpHeld: number;
  /** Cleared on take-off, rearmed on release, so a held key can't auto-bounce. */
  jumpArmed: boolean;
  /** Winding up a jump: the suspension squats before it throws. */
  crouching: boolean;
  crouchT: number;
  /**
   * Full orientation, used whenever the wheels are not deciding it — in flight
   * and after a crash. On the ground the terrain solution takes over again.
   */
  quat: THREE.Quaternion;
  /** Angular velocity, world axes, rad/s. */
  omega: THREE.Vector3;
  /** Landed far enough from upright that it is on its side or its back. */
  crashed: boolean;
  /** 1 at touchdown, fading to 0 as the terrain takes the attitude back. */
  landBlend: number;
  landQuat: THREE.Quaternion;
  /** Crouch/extend animation offset, m. Driven, not sprung. */
  compress: number;
  /** Suspension spring: vertical travel and the rock about each axis. */
  suspY: number;
  suspVY: number;
  suspPitch: number;
  suspVPitch: number;
  suspRoll: number;
  suspVRoll: number;
  drifting: boolean;
  /** Slip angle between where it points and where it is going, radians. */
  slipAngle: number;
  yawRate: number;
  /** Speed the wheels are rolling at, which slip can divorce from the ground. */
  wheelSpeed: number;
  slip: number;
  odometer: number;
  trueOdometer: number;
  battery: number;
}

export function createDriveState(yaw: number): DriveState {
  return {
    x: 0,
    z: 0,
    yaw,
    vFwd: 0,
    vLat: 0,
    vel: new THREE.Vector3(),
    airY: 0,
    airborne: false,
    airtime: 0,
    jumpHeld: 0,
    jumpArmed: true,
    crouching: false,
    crouchT: 0,
    quat: new THREE.Quaternion(),
    omega: new THREE.Vector3(),
    crashed: false,
    landBlend: 0,
    landQuat: new THREE.Quaternion(),
    compress: 0,
    suspY: 0,
    suspVY: 0,
    suspPitch: 0,
    suspVPitch: 0,
    suspRoll: 0,
    suspVRoll: 0,
    drifting: false,
    slipAngle: 0,
    yawRate: 0,
    wheelSpeed: 0,
    slip: 0,
    odometer: 0,
    trueOdometer: 0,
    battery: BATTERY_JOULES,
  };
}

export interface DriveInput {
  throttle: number;
  steer: number;
  brake: boolean;
  boost: boolean;
  /** Held, for the variable-height boost while still rising. */
  jump: boolean;
  /** Edge: one press, consumed once. Never missed, however slow the frame. */
  jumpPressed: boolean;
  /** Handbrake. */
  drift: boolean;
  reset: boolean;
}

export interface DriveContext {
  /** Terrain slope along travel, degrees. Positive is uphill. */
  gradeDeg: number;
  /** Sim only: how much faster than real time everything is running. */
  timeCompression: number;
  /** Steering angle the front pair has actually reached, radians. */
  frontAngle: number;
  cornerArm: number;
  /**
   * Terrain curvature along the direction of travel, 1/m. Positive over a
   * crest. Wheels can only push up, so once curvature times speed squared
   * exceeds gravity the ground cannot hold the vehicle down any longer.
   */
  convexity: number;
  /** Rate the ground was rising per metre travelled, just behind the rover. */
  riseRate: number;
  /** Vertical acceleration the terrain is imposing on the hull, m/s^2. */
  groundAccelY: number;
  /** And the angular equivalents, rad/s^2. */
  pitchAccel: number;
  rollAccel: number;
  /** Corners commanded into the turn-in-place pattern. */
  turningInPlace: boolean;
  /** 0..1, how close the corner actuators are to their commanded angle. */
  aligned: number;
  /** Attitude the terrain is currently imposing, and how fast it is changing. */
  pitch: number;
  roll: number;
  pitchRate: number;
  rollRate: number;
}

const decay = (rate: number, dt: number) => Math.exp(-rate * dt);

/**
 * Suspension spring.
 *
 * A damped spring rather than an exponential fade, because the difference is
 * exactly what "absorbing" looks like: it takes the load, bottoms out, and
 * pushes back with a little overshoot instead of just sliding back to rest.
 * Run for both modes and both axes, so a landing on one corner rocks the hull
 * the way the linkage would.
 */
function settleSpring(s: DriveState, dt: number, ctx?: DriveContext) {
  const k = ARCADE.suspK;
  const c = ARCADE.suspC;

  // Drive the spring with the ground.
  //
  // A suspension is not only a landing device. Writing the body's height as a
  // spring between it and the surface, the equation of motion for the
  // compression u is u'' = a_ground - k*u - c*u', so the vertical acceleration
  // the terrain imposes is a forcing term. Feeding it in is what makes the
  // hull work continuously over rough ground rather than only when it lands —
  // the body lags a rise, compresses, and pushes back.
  const aY = ctx ? THREE.MathUtils.clamp(ctx.groundAccelY, -26, 26) : 0;
  const aP = ctx ? THREE.MathUtils.clamp(ctx.pitchAccel, -14, 14) : 0;
  const aR = ctx ? THREE.MathUtils.clamp(ctx.rollAccel, -14, 14) : 0;
  // Implicit (backward Euler) rather than explicit.
  //
  // Explicit integration of a stiff damped spring is only stable while
  // c * dt < 1. At this damping that breaks above a 48 ms frame — and dt is
  // clamped at 50 ms — so a single slow frame overshot the damping term and
  // flipped the velocity's sign, throwing away the impact and jolting the
  // hull. Solving for the new velocity instead is unconditionally stable, so
  // the landing looks the same at 15 fps as at 120.
  const denom = 1 + c * dt + k * dt * dt;
  s.suspVY = (s.suspVY + aY * dt - k * dt * s.suspY) / denom;
  s.suspY = THREE.MathUtils.clamp(s.suspY + s.suspVY * dt, -0.12, ARCADE.suspTravel);
  s.suspVPitch = (s.suspVPitch + aP * dt - k * dt * s.suspPitch) / denom;
  s.suspPitch = THREE.MathUtils.clamp(s.suspPitch + s.suspVPitch * dt, -0.3, 0.3);
  s.suspVRoll = (s.suspVRoll + aR * dt - k * dt * s.suspRoll) / denom;
  s.suspRoll = THREE.MathUtils.clamp(s.suspRoll + s.suspVRoll * dt, -0.3, 0.3);
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, "YXZ");
const _up = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Leave the ground.
 *
 * Take-off attitude is whatever the ground had it at, and it keeps rotating at
 * whatever rate the ground was rotating it — drive off a crest and the nose
 * keeps dropping.
 */
function launch(s: DriveState, c: DriveContext, vy: number, tip: number) {
  s.vel.y = vy;
  s.airborne = true;
  s.jumpHeld = 0;
  s.airY = 0.001;
  s.airtime = 0;

  _e.set(c.pitch, s.yaw, c.roll, "YXZ");
  s.quat.setFromEuler(_e);
  const speed = Math.hypot(s.vel.x, s.vel.z);
  s.omega.set(c.pitchRate + tip * speed, 0, c.rollRate);
  if (s.omega.length() > ARCADE.maxLaunchSpin) s.omega.setLength(ARCADE.maxLaunchSpin);
  s.omega.applyQuaternion(s.quat);
}

/** Put the rover back on its wheels where it stands. */
export function resetDrive(s: DriveState) {
  s.crashed = false;
  s.airborne = false;
  s.airY = 0;
  s.airtime = 0;
  s.vel.set(0, 0, 0);
  s.vFwd = 0;
  s.vLat = 0;
  s.omega.set(0, 0, 0);
  s.quat.identity();
  s.landBlend = 0;
  s.landQuat.identity();
  s.compress = 0;
  s.suspY = 0;
  s.suspVY = 0;
  s.suspPitch = 0;
  s.suspVPitch = 0;
  s.suspRoll = 0;
  s.suspVRoll = 0;
  s.drifting = false;
  s.slipAngle = 0;
}

/** Advance the arcade model. `dt` is real seconds. */
export function stepArcade(s: DriveState, i: DriveInput, dt: number, c: DriveContext) {
  if (i.reset) resetDrive(s);

  if (s.crashed) {
    // Sitting on its back. Nothing but the reset does anything.
    s.vel.set(0, 0, 0);
    s.vFwd = 0;
    s.vLat = 0;
    s.yawRate = 0;
    s.wheelSpeed *= decay(2, dt);
    return;
  }

  const top = i.boost ? ARCADE.boostSpeed : ARCADE.topSpeed;

  if (s.airborne) {
    // --- free flight ---------------------------------------------------------
    // Nothing is touching the ground to push against, so there is nothing to
    // steer with. The exception is a skim: at speed this terrain throws the
    // rover off almost every crest, and if all control vanished on each one it
    // would be undriveable — so while the wheels are still within half a metre
    // of the ground they are treated as catching it often enough to bite.
    const skim = s.airY < ARCADE.skimHeight;
    s.yawRate = skim ? i.steer * ARCADE.yawRate * ARCADE.skimSteer : 0;
    s.yaw += s.yawRate * dt;
    if (skim && i.throttle !== 0) {
      const sn = Math.sin(s.yaw);
      const cs = Math.cos(s.yaw);
      s.vel.x += -sn * i.throttle * ARCADE.accel * ARCADE.skimThrottle * dt;
      s.vel.z += -cs * i.throttle * ARCADE.accel * ARCADE.skimThrottle * dt;
    }

    if (i.jump && s.jumpHeld < ARCADE.holdTime && s.vel.y > 0) {
      s.vel.y += ARCADE.hold * dt;
      s.jumpHeld += dt;
    }
    s.vel.y -= MARS.gravity * dt;

    s.x += s.vel.x * dt;
    s.z += s.vel.z * dt;
    s.airY += s.vel.y * dt;
    s.airtime += dt;
    // The suspension droops back out once it is unloaded.
    s.compress *= decay(6, dt);

    // Tumble. A low, heavy chassis slung under the wheels wants to come back
    // upright, so nudge the spin toward putting the wheels down. Not enough to
    // rescue a bad launch — enough that a normal jump lands on its feet.
    _up.set(0, 1, 0).applyQuaternion(s.quat);
    _axis.crossVectors(_up, _WORLD_UP);
    const lean = _axis.length();
    if (lean > 1e-4) {
      _axis.divideScalar(lean);
      s.omega.addScaledVector(_axis, ARCADE.righting * lean * dt);
    }
    s.omega.multiplyScalar(decay(ARCADE.spinDamping, dt));
    const rate = s.omega.length();
    if (rate > 1e-6) {
      _axis.copy(s.omega).divideScalar(rate);
      _q.setFromAxisAngle(_axis, rate * dt);
      s.quat.premultiply(_q);
      s.quat.normalize();
    }

    if (s.airY <= 0) {
      // --- touchdown ---------------------------------------------------------
      _up.set(0, 1, 0).applyQuaternion(s.quat);
      const tilt = Math.acos(THREE.MathUtils.clamp(_up.y, -1, 1));

      s.airY = 0;
      s.airborne = false;
      s.airtime = 0;
      s.jumpHeld = 0;

      if (tilt > ARCADE.crashAngle) {
        // Came down on its side or its back. It stays there.
        s.crashed = true;
        s.omega.set(0, 0, 0);
        s.vel.set(0, 0, 0);
      } else {
        // Rolled it out. Keep the heading it landed on, hand attitude back to
        // the terrain, and let the drop compress the suspension.
        _e.setFromQuaternion(s.quat, "YXZ");
        s.yaw = _e.y;

        // Ease out of the flight orientation instead of snapping to the ground.
        s.landQuat.copy(s.quat);
        s.landBlend = 1;

        // Load the spring with the impact.
        s.suspVY += Math.min(ARCADE.suspMaxTake, Math.abs(s.vel.y) * ARCADE.suspTake);

        // Rock by how badly the attitude *disagreed with the ground*, not by
        // the absolute attitude. Land matching the slope and it barely stirs.
        const dPitch = _e.x - c.pitch;
        const dRoll = _e.z - c.roll;
        s.suspVPitch += THREE.MathUtils.clamp(
          -dPitch * ARCADE.rockGain, -ARCADE.rockMax, ARCADE.rockMax
        );
        s.suspVRoll += THREE.MathUtils.clamp(
          -dRoll * ARCADE.rockGain, -ARCADE.rockMax, ARCADE.rockMax
        );
        s.omega.set(0, 0, 0);
        s.vel.y = 0;
      }
    }
  } else {
    // --- on the wheels -------------------------------------------------------
    if (!i.jump) s.jumpArmed = true;
    if (i.jumpPressed && s.jumpArmed && !s.crouching) {
      s.crouching = true;
      s.crouchT = 0;
      s.jumpArmed = false;
    }

    if (s.crouching) {
      // Squat onto the suspension, then let it throw the rover off the ground.
      s.crouchT += dt;
      const k = Math.min(1, s.crouchT / ARCADE.crouchTime);
      s.compress = ARCADE.crouchDepth * Math.sin(k * Math.PI * 0.5);
      if (s.crouchT >= ARCADE.crouchTime) {
        s.crouching = false;
        s.compress = ARCADE.extend;
        s.vel.y = ARCADE.jump;
        s.airborne = true;
        s.jumpHeld = 0;
        s.airY = 0.001;

      // Take-off attitude is whatever the ground had it at, and it keeps
      // rotating at whatever rate the ground was rotating it — drive off a
      // crest and the nose keeps dropping. Plus a kick of nose-up so a jump
      // off the flat still looks like a jump.
        _e.set(c.pitch, s.yaw, c.roll, "YXZ");
        s.quat.setFromEuler(_e);
        const speed = Math.hypot(s.vel.x, s.vel.z);
        s.omega.set(c.pitchRate + ARCADE.launchTip * speed, 0, c.rollRate);
        if (s.omega.length() > ARCADE.maxLaunchSpin) {
          s.omega.setLength(ARCADE.maxLaunchSpin);
        }
        s.omega.applyQuaternion(s.quat);
      }
    }

    const sin = Math.sin(s.yaw);
    const cos = Math.cos(s.yaw);
    const fx = -sin;
    const fz = -cos;

    // Throttle acts along the heading; the velocity vector may point elsewhere.
    if (i.throttle !== 0) {
      s.vel.x += fx * i.throttle * ARCADE.accel * dt;
      s.vel.z += fz * i.throttle * ARCADE.accel * dt;
    }

    let speed = Math.hypot(s.vel.x, s.vel.z);
    if (i.throttle === 0) {
      const k = decay(ARCADE.drag, dt);
      s.vel.x *= k;
      s.vel.z *= k;
    }
    if (i.brake || i.drift) {
      const k = decay(i.drift ? ARCADE.handbrakeDrag : ARCADE.brake / 8, dt);
      s.vel.x *= k;
      s.vel.z *= k;
    }
    speed = Math.hypot(s.vel.x, s.vel.z);
    if (speed > top) {
      s.vel.x *= top / speed;
      s.vel.z *= top / speed;
      speed = top;
    }

    // Which way round is the hull facing relative to travel?
    const along = s.vel.x * fx + s.vel.z * fz;
    const reversing = along < -0.2;
    const hx = reversing ? -fx : fx;
    const hz = reversing ? -fz : fz;

    const speedFrac = Math.min(1, speed / ARCADE.topSpeed);
    s.drifting = i.drift && speed > 2;
    const yawScale = s.drifting ? 1 + ARCADE.handbrakeYawBonus : 1;
    s.yawRate =
      i.steer * ARCADE.yawRate * (0.4 + 0.6 * speedFrac) * yawScale * (reversing ? -1 : 1);
    s.yaw += s.yawRate * dt;

    // Grip drags the velocity vector back toward the heading. Pull the
    // handbrake and it barely does, so the hull swings round while the rover
    // keeps travelling the way it already was — a handbrake turn.
    if (speed > 0.05) {
      const cross = s.vel.x * hz - s.vel.z * hx;
      const dot = s.vel.x * hx + s.vel.z * hz;
      const slip = Math.atan2(cross, dot);
      s.slipAngle = slip;
      const grip = s.drifting ? ARCADE.handbrakeGrip : ARCADE.grip;
      const turn = THREE.MathUtils.clamp(-slip, -grip * dt, grip * dt);
      const ca = Math.cos(turn);
      const sa = Math.sin(turn);
      const nx = s.vel.x * ca + s.vel.z * sa;
      const nz = -s.vel.x * sa + s.vel.z * ca;
      s.vel.x = nx;
      s.vel.z = nz;
    } else {
      s.slipAngle = 0;
    }

    s.x += s.vel.x * dt;
    s.z += s.vel.z * dt;
    if (!s.crouching) s.compress *= decay(9, dt);

    // Crests. The ground can only push, never pull, so it stops being able to
    // hold the rover down the moment the curvature it is being asked to follow
    // demands more than gravity: convexity * v^2 > g. In 3.7 m/s^2 that is a
    // low bar — at 15 m/s any crest tighter than a 60 m radius does it — which
    // is why driving fast here means spending a good deal of time just off the
    // ground. The launch speed is the vertical speed it already had from
    // climbing the near side, so a gentle rise lofts it gently.
    if (!s.airborne && !s.crouching && speed > 2.5) {
      if (c.convexity * speed * speed > MARS.gravity * ARCADE.launchMargin) {
        const vy = Math.min(ARCADE.maxBumpVy, speed * Math.max(0, c.riseRate));
        if (vy > 0.35) launch(s, c, vy, ARCADE.launchTip * 0.5);
      }
    }

    // Only flatten the vertical velocity if we are actually still down here.
    // The launch happens above, in this same branch, and zeroing it
    // unconditionally cancelled every jump on the frame it was made.
    if (!s.airborne) s.vel.y = 0;
  }

  // Clamp horizontal speed once, after both branches. The skim throttle adds
  // velocity while airborne, which used to escape the grounded clamp entirely.
  {
    const top = i.boost ? ARCADE.boostSpeed : ARCADE.topSpeed;
    const h = Math.hypot(s.vel.x, s.vel.z);
    if (h > top) {
      s.vel.x *= top / h;
      s.vel.z *= top / h;
    }
  }

  settleSpring(s, dt, c);
  if (s.landBlend > 0) {
    s.landBlend = s.landBlend < 0.01 ? 0 : s.landBlend * decay(1 / ARCADE.landBlendTau, dt);
  }

  const ground = Math.hypot(s.vel.x, s.vel.z);
  const sin = Math.sin(s.yaw);
  const cos = Math.cos(s.yaw);
  s.vFwd = s.vel.x * -sin + s.vel.z * -cos;
  s.vLat = s.vel.x * cos - s.vel.z * sin;
  s.odometer += ground * dt;
  s.trueOdometer += ground * dt;
  // Wheels keep turning in the air, and keep turning through a slide.
  s.wheelSpeed = s.airborne ? s.wheelSpeed * decay(0.4, dt) : s.vFwd;
  s.slip = Math.min(1, Math.abs(s.slipAngle) / 0.9);
  s.battery = BATTERY_JOULES;
}

/** Advance the simulation model. `dt` is real seconds. */
export function stepSim(s: DriveState, i: DriveInput, dt: number, c: DriveContext) {
  if (i.reset) resetDrive(s);

  // Everything below runs in Mars seconds, of which a real second buys many.
  const t = dt * c.timeCompression;

  const target = i.throttle * MARS.roverTopSpeed;
  s.vFwd += Math.max(-SIM_ACCEL * t, Math.min(SIM_ACCEL * t, target - s.vFwd));
  if (i.brake) s.vFwd *= decay(6, t);
  s.vLat = 0;

  if (c.turningInPlace) {
    s.vFwd *= decay(8, t);
    // Wheels still slewing cannot put much into the ground yet.
    s.yawRate = i.steer * SIM_TURN_RATE * c.aligned;
  } else {
    s.yawRate = (s.vFwd * Math.tan(c.frontAngle)) / c.cornerArm;
  }
  s.yaw += s.yawRate * t;

  // Wheels turn at the commanded rate; the ground only gives back some of it.
  s.wheelSpeed = s.vFwd;
  s.slip = slipFraction(c.gradeDeg) * (Math.abs(s.vFwd) > 1e-4 ? 1 : 0);
  const ground = s.vFwd * (1 - s.slip);

  s.x -= Math.sin(s.yaw) * ground * t;
  s.z -= Math.cos(s.yaw) * ground * t;
  s.odometer += Math.abs(s.vFwd) * t;
  s.trueOdometer += Math.abs(ground) * t;

  // Power. Driving costs more than the RTG makes, which is exactly why a real
  // sol is mostly spent sitting still charging.
  const moving = Math.abs(s.vFwd) > 1e-4 || c.turningInPlace;
  const draw = HOTEL_WATTS + (moving ? DRIVE_WATTS : 0);
  s.battery = Math.max(0, Math.min(BATTERY_JOULES, s.battery + (RTG_WATTS - draw) * t));
  if (s.battery <= 0) s.vFwd *= decay(4, t);

  // Nothing in the simulation leaves the ground.
  s.airY = 0;
  s.airborne = false;
  s.crashed = false;
  s.vel.set(0, 0, 0);
  s.compress *= decay(9, dt);
  // Real time, not compressed: a suspension settles in about a second whatever
  // the clock is doing.
  settleSpring(s, dt, c);
}
