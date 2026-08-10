"use client";

import { create } from "zustand";

import type { ViewId } from "./cameras";
import { VIEWS } from "./cameras";
import { initialLocalTime, initialLs, initialModel, initialView } from "./params";

export type ModelKind = "flight" | "engineering";

export const MODEL_LABELS: Record<ModelKind, string> = {
  flight: "FLIGHT MODEL",
  engineering: "ENGINEERING MODEL",
};

interface UiState {
  /** Which camera we are looking through. */
  view: ViewId;
  modelKind: ModelKind;
  /** Solar longitude, degrees. Mars' seasonal coordinate. */
  ls: number;
  /** Sols per real-world minute while time is running. */
  timeRate: number;
  timeFrozen: boolean;
  /** How much faster than the real 4 cm/s we let the rover go. */
  speedScale: number;
  showHud: boolean;
  showHelp: boolean;
  setView: (v: ViewId) => void;
  cycleView: () => void;
  toggleModel: () => void;
  setLs: (v: number) => void;
  setTimeRate: (v: number) => void;
  toggleTimeFrozen: () => void;
  setSpeedScale: (v: number) => void;
  toggleHud: () => void;
  toggleHelp: () => void;
}

export const useUi = create<UiState>((set) => ({
  view: initialView(),
  modelKind: initialModel(),
  ls: initialLs(),
  timeRate: 0.06,
  timeFrozen: false,
  speedScale: 120,
  showHud: true,
  showHelp: true,
  setView: (view) => set({ view }),
  cycleView: () =>
    set((s) => {
      const i = VIEWS.findIndex((v) => v.id === s.view);
      return { view: VIEWS[(i + 1) % VIEWS.length].id };
    }),
  toggleModel: () =>
    set((s) => ({ modelKind: s.modelKind === "flight" ? "engineering" : "flight" })),
  setLs: (ls) => set({ ls }),
  setTimeRate: (timeRate) => set({ timeRate }),
  toggleTimeFrozen: () => set((s) => ({ timeFrozen: !s.timeFrozen })),
  setSpeedScale: (speedScale) => set({ speedScale }),
  toggleHud: () => set((s) => ({ showHud: !s.showHud })),
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
