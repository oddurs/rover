"use client";

import { create } from "zustand";

import type { ViewId } from "./cameras";
import { VIEWS } from "./cameras";
import type { DriveMode } from "./drive";
import { DRIVEABLE, type VehicleId } from "./vehicles";
import {
  initialLocalTime,
  initialLs,
  initialMode,
  initialModel,
  initialView,
} from "./params";

/** Which rover is on the ground. See lib/vehicles.ts. */
export type ModelKind = VehicleId;

export const MODE_LABELS: Record<DriveMode, string> = {
  sim: "SIMULATION",
  arcade: "ARCADE",
};

interface UiState {
  /** Which camera we are looking through. */
  view: ViewId;
  modelKind: ModelKind;
  /** Which physics model is driving. */
  mode: DriveMode;
  /** Simulation only: how much faster than real time everything runs. */
  timeCompression: number;
  /** Solar longitude, degrees. Mars' seasonal coordinate. */
  ls: number;
  /** Sols per real-world minute while time is running. */
  timeRate: number;
  timeFrozen: boolean;
  showHud: boolean;
  /** Red/cyan anaglyph on the stereo instruments. */
  stereo: boolean;
  /** Mastcam filter wheel position. */
  filter: string;
  /** Draw Curiosity's real route across the terrain. */
  showTraverse: boolean;
  showHelp: boolean;
  setView: (v: ViewId) => void;
  setMode: (m: DriveMode) => void;
  /** Bumped to ask the rover to right itself. */
  resetNonce: number;
  requestReset: () => void;
  setTimeCompression: (v: number) => void;
  cycleView: () => void;
  toggleModel: () => void;
  setLs: (v: number) => void;
  setTimeRate: (v: number) => void;
  toggleTimeFrozen: () => void;
  toggleHud: () => void;
  toggleStereo: () => void;
  setFilter: (id: string) => void;
  toggleTraverse: () => void;
  toggleHelp: () => void;
}

export const useUi = create<UiState>((set) => ({
  view: initialView(),
  modelKind: initialModel(),
  mode: initialMode(),
  timeCompression: 25,
  ls: initialLs(),
  timeRate: 0.06,
  timeFrozen: false,
  showHud: true,
  stereo: false,
  filter: "L0",
  // Off by default — it is a striking overlay, but it sits on top of the
  // terrain rather than being part of it. Press G when you want it.
  showTraverse: false,
  showHelp: true,
  setView: (view) => set({ view }),
  setMode: (mode) => set({ mode }),
  resetNonce: 0,
  requestReset: () => set((s) => ({ resetNonce: s.resetNonce + 1 })),
  setTimeCompression: (timeCompression) => set({ timeCompression }),
  cycleView: () =>
    set((s) => {
      const i = VIEWS.findIndex((v) => v.id === s.view);
      return { view: VIEWS[(i + 1) % VIEWS.length].id };
    }),
  // Cycles the real vehicles. The procedural engineering model stays
  // reachable at ?model=engineering, since it is the only one that articulates.
  toggleModel: () =>
    set((s) => {
      const i = DRIVEABLE.indexOf(s.modelKind);
      return { modelKind: DRIVEABLE[(i + 1) % DRIVEABLE.length] };
    }),
  setLs: (ls) => set({ ls }),
  setTimeRate: (timeRate) => set({ timeRate }),
  toggleTimeFrozen: () => set((s) => ({ timeFrozen: !s.timeFrozen })),
  toggleHud: () => set((s) => ({ showHud: !s.showHud })),
  toggleStereo: () => set((s) => ({ stereo: !s.stereo })),
  setFilter: (filter) => set({ filter }),
  toggleTraverse: () => set((s) => ({ showTraverse: !s.showTraverse })),
  toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),
}));

/**
 * Live rover telemetry.
 *
 * Deliberately *not* in the store: this changes every frame, and pushing it
 * through React would re-render the tree at 60 Hz. The HUD polls it instead.
 */
export const telemetry = {
  x: 0,
  z: 0,
  elevation: 0,
  yaw: 0,
  pitch: 0,
  roll: 0,
  grade: 0,
  speed: 0,
  odometer: 0,
  /** Distance actually covered, which slip separates from the odometry. */
  trueOdometer: 0,
  slip: 0,
  battery: 1,
  airborne: false,
  airY: 0,
  airtime: 0,
  drifting: false,
  lateral: 0,
  crashed: false,
  crouching: false,
  currents: [0, 0, 0, 0, 0, 0] as number[],
  rockerLeft: 0,
  rockerRight: 0,
  bogieLeft: 0,
  bogieRight: 0,
  sol: 0,
  localTime: initialLocalTime(),
  sunElevation: 0,
  sunAzimuth: 0,
};

export type Telemetry = typeof telemetry;
