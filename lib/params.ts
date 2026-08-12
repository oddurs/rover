/**
 * Deep-link parameters, so a particular view can be shared as a URL.
 *
 *   ?hdg=138   heading in degrees from north
 *   ?t=17.6    local true solar time, hours
 *   ?ls=250    solar longitude (season), degrees
 *   ?cam=hazcam-front   any instrument id from lib/cameras.ts
 *   ?mode=arcade
 */

import type { ViewId } from "./cameras";
import { VIEWS } from "./cameras";
import type { DriveMode } from "./drive";
import type { ModelKind } from "./store";

const MODELS: ModelKind[] = ["curiosity", "perseverance", "engineering"];

function read(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

function num(key: string, fallback: number, lo: number, hi: number): number {
  const p = read();
  const raw = p?.get(key);
  if (raw === null || raw === undefined) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

/** Initial rover yaw in radians. Yaw runs opposite to compass heading. */
export function initialYaw(): number {
  return (-num("hdg", 0, -360, 360) * Math.PI) / 180;
}

export function initialLocalTime(): number {
  return num("t", 9.4, 0, 23.999);
}

export function initialLs(): number {
  return num("ls", 150, 0, 359);
}

export function initialView(): ViewId {
  const raw = read()?.get("cam");
  return VIEWS.some((v) => v.id === raw) ? (raw as ViewId) : "orbit";
}

export function initialModel(): ModelKind {
  const raw = read()?.get("model");
  return MODELS.includes(raw as ModelKind) ? (raw as ModelKind) : "curiosity";
}

export function initialMode(): DriveMode {
  return read()?.get("mode") === "arcade" ? "arcade" : "sim";
}
