"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { bearingTo, landmarks, toLatLon, type Landmark } from "@/lib/landmarks";
import { GALE, MARS, compass, formatLTST } from "@/lib/mars";
import { VIEWS, getView } from "@/lib/cameras";
import { BATTERY_JOULES, SIM_TURN_RATE } from "@/lib/drive";
import { MODE_LABELS, telemetry, useUi } from "@/lib/store";
import { Imaging } from "@/components/Imaging";
import { FILTERS, getFilter } from "@/lib/filters";
import { VEHICLES } from "@/lib/vehicles";

const DEG = 180 / Math.PI;

function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`panel px-3.5 py-3 ${className}`}>{children}</div>;
}

/**
 * A readout slot. The value is written straight into the DOM by the polling
 * loop below, addressed by `data-tm`, so none of these numbers ever go through
 * React state.
 */
function Field({
  label,
  id,
  unit,
}: {
  label: string;
  id: string;
  unit?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label">{label}</span>
      <span className="flex items-baseline gap-1">
        <span data-tm={id} className="value">
          —
        </span>
        {unit && <span className="text-[10px] text-[var(--color-ink-faint)]">{unit}</span>}
      </span>
    </div>
  );
}

export function Hud({ ready }: { ready: boolean }) {
  const viewId = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const cycleView = useUi((s) => s.cycleView);
  const view = getView(viewId);
  const showHud = useUi((s) => s.showHud);
  const toggleHud = useUi((s) => s.toggleHud);
  const showHelp = useUi((s) => s.showHelp);
  const toggleHelp = useUi((s) => s.toggleHelp);
  const timeFrozen = useUi((s) => s.timeFrozen);
  const toggleTimeFrozen = useUi((s) => s.toggleTimeFrozen);
  const ls = useUi((s) => s.ls);
  const setLs = useUi((s) => s.setLs);
  const mode = useUi((s) => s.mode);
  const setMode = useUi((s) => s.setMode);
  const timeCompression = useUi((s) => s.timeCompression);
  const requestReset = useUi((s) => s.requestReset);
  const stereo = useUi((s) => s.stereo);
  const toggleTraverse = useUi((s) => s.toggleTraverse);
  const filterId = useUi((s) => s.filter);
  const setFilter = useUi((s) => s.setFilter);
  const toggleStereo = useUi((s) => s.toggleStereo);
  const setTimeCompression = useUi((s) => s.setTimeCompression);
  const modelKind = useUi((s) => s.modelKind);
  const toggleModel = useUi((s) => s.toggleModel);

  const [showSettings, setShowSettings] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // landmarks() derives from the loaded elevation grid and caches, so this is
  // a stable array rather than something that needs to live in state.
  const marks: Landmark[] = useMemo(() => (ready ? landmarks() : []), [ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "KeyC") cycleView();
      else if (e.code === "KeyH") toggleHud();
      else if (e.code === "KeyT") toggleTimeFrozen();
      else if (e.code === "KeyM") toggleModel();
      else if (e.code === "Digit1") setMode("sim");
      else if (e.code === "Digit2") setMode("arcade");
      else if (e.code === "KeyR") requestReset();
      else if (e.code === "KeyE") toggleStereo();
      else if (e.code === "KeyG") toggleTraverse();
      else if (e.code === "Slash") toggleHelp();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleView, toggleHud, toggleTimeFrozen, toggleHelp, toggleModel, setMode, requestReset, toggleStereo, toggleTraverse]);

  // Telemetry changes every frame. Poll it and write straight into the DOM
  // rather than routing 60 Hz of numbers through React.
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let last = 0;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 66) return; // ~15 Hz is plenty for reading numbers
      last = t;

      const root = rootRef.current;
      if (!root) return;

      const nodes = new Map<string, HTMLElement>();
      root.querySelectorAll<HTMLElement>("[data-tm]").forEach((el) => {
        nodes.set(el.dataset.tm!, el);
      });

      const set = (k: string, v: string) => {
        const el = nodes.get(k);
        if (el && el.textContent !== v) el.textContent = v;
      };

      set("ltst", formatLTST(telemetry.localTime));
      set("sol", `SOL ${telemetry.sol}`);
      set(
        "sun",
        `${telemetry.sunElevation >= 0 ? "+" : ""}${telemetry.sunElevation.toFixed(1)}° / ${telemetry.sunAzimuth.toFixed(0)}°`
      );

      const { lat, lon } = toLatLon(telemetry.x, telemetry.z);
      set("lat", `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? "S" : "N"}`);
      set("lon", `${lon.toFixed(4)}° E`);
      set("elev", `${telemetry.elevation.toFixed(1)}`);

      const heading = (((-telemetry.yaw * DEG) % 360) + 360) % 360;
      set("hdg", `${heading.toFixed(0).padStart(3, "0")}°`);
      set("compass", compass(heading));

      if (mode === "arcade") {
        set("speed", `${Math.abs(telemetry.speed).toFixed(1)}`);
        set(
          "truespeed",
          telemetry.airborne
            ? `AIRBORNE  ${telemetry.airY.toFixed(1)} m  ${telemetry.airtime.toFixed(1)} s`
            : telemetry.drifting
              ? `DRIFT  ${Math.abs(telemetry.lateral).toFixed(1)} m/s lateral`
              : ""
        );
      } else {
        set("speed", `${(telemetry.speed * 100).toFixed(1)}`);
        set("truespeed", `true rate · ×${timeCompression} time`);
      }
      const odoM = mode === "arcade" ? telemetry.odometer : telemetry.trueOdometer;
      set("odo", odoM > 1000 ? `${(odoM / 1000).toFixed(2)} km` : `${odoM.toFixed(1)} m`);
      set(
        "slip",
        telemetry.slip > 0.01 ? `${(telemetry.slip * 100).toFixed(0)}% slip` : "no slip"
      );
      const slipEl = nodes.get("slip");
      if (slipEl) {
        slipEl.style.color =
          telemetry.slip > 0.5
            ? "var(--color-warn)"
            : telemetry.slip > 0.15
              ? "var(--color-amber)"
              : "var(--color-ink-faint)";
      }
      const crashWrap = nodes.get("crashwrap");
      if (crashWrap) crashWrap.style.display = telemetry.crashed ? "block" : "none";

      const soc = telemetry.battery / BATTERY_JOULES;
      set("soc", `${(soc * 100).toFixed(0)}%`);
      const socBar = nodes.get("socbar");
      if (socBar) {
        socBar.style.width = `${Math.max(0, soc * 100)}%`;
        socBar.style.background =
          soc < 0.15 ? "var(--color-warn)" : soc < 0.35 ? "var(--color-amber)" : "var(--color-signal)";
      }

      set("pitch", `${(telemetry.pitch * DEG).toFixed(1)}°`);
      set("roll", `${(telemetry.roll * DEG).toFixed(1)}°`);
      set("grade", `${telemetry.grade >= 0 ? "+" : ""}${telemetry.grade.toFixed(1)}°`);

      const tilt = Math.hypot(telemetry.pitch, telemetry.roll) * DEG;
      set("tilt", `${tilt.toFixed(1)}°`);
      const tiltEl = nodes.get("tilt");
      if (tiltEl) {
        // Curiosity's flight rules keep it under about 30 degrees of tilt.
        tiltEl.style.color =
          tilt > 30 ? "var(--color-warn)" : tilt > 20 ? "var(--color-amber)" : "";
      }

      set("rockL", `${(telemetry.rockerLeft * DEG).toFixed(1)}°`);
      set("rockR", `${(telemetry.rockerRight * DEG).toFixed(1)}°`);
      set("bogL", `${(telemetry.bogieLeft * DEG).toFixed(1)}°`);
      set("bogR", `${(telemetry.bogieRight * DEG).toFixed(1)}°`);

      for (let i = 0; i < 6; i++) {
        const bar = nodes.get(`cur${i}`);
        if (bar) {
          const pct = Math.min(100, (telemetry.currents[i] / 3.2) * 100);
          bar.style.width = `${pct}%`;
          bar.style.background =
            pct > 82
              ? "var(--color-warn)"
              : pct > 55
                ? "var(--color-amber)"
                : "var(--color-signal)";
        }
      }

      for (let i = 0; i < marks.length; i++) {
        const b = bearingTo(marks[i], telemetry.x, telemetry.z);
        const dist =
          b.distance > 1000
            ? `${(b.distance / 1000).toFixed(1)} km`
            : `${b.distance.toFixed(0)} m`;
        set(`lm${i}`, `${dist}  ${b.bearing.toFixed(0).padStart(3, "0")}°`);
      }

      const slider = nodes.get("timeSlider") as HTMLInputElement | undefined;
      if (slider && document.activeElement !== slider) {
        slider.value = telemetry.localTime.toFixed(3);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, marks, mode, timeCompression]);

  if (!ready) return null;

  const instrument = view.mount !== "external";

  return (
    <div ref={rootRef} className="pointer-events-none fixed inset-0 select-none">
      <Imaging />

      {/* Reticle, only in the mast views. */}
      {instrument && showHud && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative h-24 w-24 opacity-40">
            <div className="absolute left-1/2 top-0 h-5 w-px -translate-x-1/2 bg-[var(--color-amber)]" />
            <div className="absolute left-1/2 bottom-0 h-5 w-px -translate-x-1/2 bg-[var(--color-amber)]" />
            <div className="absolute top-1/2 left-0 h-px w-5 -translate-y-1/2 bg-[var(--color-amber)]" />
            <div className="absolute top-1/2 right-0 h-px w-5 -translate-y-1/2 bg-[var(--color-amber)]" />
          </div>
        </div>
      )}

      {/* Upside down: nothing works until it is righted. */}
      {mode === "arcade" && (
        <div
          data-tm="crashwrap"
          className="pointer-events-none absolute left-1/2 top-[18%] -translate-x-1/2"
          style={{ display: "none" }}
        >
          <div className="panel px-5 py-3 text-center">
            <div className="text-[12px] tracking-[0.2em] text-[var(--color-warn)]">
              ON ITS BACK
            </div>
            <p className="mt-1 text-[9px] text-[var(--color-ink-faint)]">
              Landed past 60° from upright. It is not getting up on its own.
            </p>
            <button
              onClick={requestReset}
              className="pointer-events-auto mt-2 border border-[var(--color-amber)] px-4 py-1.5 text-[10px] tracking-[0.18em] text-[var(--color-amber)] transition-colors hover:bg-[var(--color-amber)] hover:text-black"
            >
              RESET  ·  R
            </button>
          </div>
        </div>
      )}

      {!showHud && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] tracking-[0.2em] text-[var(--color-ink-faint)]">
          PRESS H FOR TELEMETRY
        </div>
      )}

      {showHud && (
        <>
          {/* --- Mission identity + clock --- */}
          <Panel className="absolute left-4 top-4 w-[268px]">
            <div className="flex items-baseline justify-between border-b border-[var(--color-edge)] pb-2">
              <span className="text-[11px] tracking-[0.18em] text-[var(--color-ink)]">
                GALE CRATER
              </span>
              <span
                data-tm="sol"
                className="text-[10px] tracking-[0.16em] text-[var(--color-amber)]"
              >
                SOL 0
              </span>
            </div>

            <div className="mt-2.5 flex items-end justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="label">Local true solar time</span>
                <span data-tm="ltst" className="value-lg">
                  00:00:00
                </span>
              </div>
              <button
                onClick={toggleTimeFrozen}
                className="pointer-events-auto border border-[var(--color-edge-strong)] px-2 py-1 text-[9px] tracking-[0.14em] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
              >
                {timeFrozen ? "RESUME" : "HOLD"}
              </button>
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-[var(--color-edge)] pt-2.5">
              <Field label="Sun el / az" id="sun" />
              <div className="flex flex-col gap-0.5">
                <span className="label">Season (Ls)</span>
                <span className="value">{ls.toFixed(0)}°</span>
              </div>
            </div>

            <p className="mt-2.5 border-t border-[var(--color-edge)] pt-2 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
              A sol runs {Math.round(MARS.solSeconds / 60)} minutes — 39 minutes
              longer than a day on Earth.
            </p>
          </Panel>

          {/* --- Navigation --- */}
          <Panel className="absolute bottom-4 left-4 w-[268px]">
            <div className="label border-b border-[var(--color-edge)] pb-2">Navigation</div>

            <div className="mt-2.5 flex items-end justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="label">Heading</span>
                <div className="flex items-baseline gap-2">
                  <span data-tm="hdg" className="value-lg">
                    000°
                  </span>
                  <span data-tm="compass" className="text-[13px] text-[var(--color-amber)]">
                    N
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="label">Ground speed</span>
                <div className="flex items-baseline gap-1">
                  <span data-tm="speed" className="value-lg">
                    0.0
                  </span>
                  <span className="text-[10px] text-[var(--color-ink-faint)]">
                    {mode === "arcade" ? "m/s" : "cm/s"}
                  </span>
                </div>
              </div>
            </div>

            <div
              data-tm="truespeed"
              className="mt-1 text-right text-[9px] text-[var(--color-ink-faint)]"
            >
              0.000 m/s true
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-[var(--color-edge)] pt-2.5">
              <Field label="Latitude" id="lat" />
              <Field label="Longitude" id="lon" />
              <Field label="Elevation" id="elev" unit="m" />
            </div>

            <div className="mt-2.5 border-t border-[var(--color-edge)] pt-2.5">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="label mb-1.5">
                    {mode === "arcade" ? "Distance" : "Distance made good"}
                  </div>
                  <span data-tm="odo" className="value">
                    0.0 m
                  </span>
                </div>
                <span data-tm="slip" className="text-[10px] text-[var(--color-ink-faint)]">
                  no slip
                </span>
              </div>
            </div>

            {mode === "sim" && (
              <div className="mt-2.5 border-t border-[var(--color-edge)] pt-2.5">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="label">Battery</span>
                  <span data-tm="soc" className="text-[10px] text-[var(--color-ink-dim)]">
                    100%
                  </span>
                </div>
                <div className="h-[3px] w-full bg-[rgba(226,148,92,0.14)]">
                  <div
                    data-tm="socbar"
                    className="h-full"
                    style={{ width: "100%", background: "var(--color-signal)" }}
                  />
                </div>
                <p className="mt-1 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
                  The RTG makes 110 W; driving draws nearer 290. A real sol is
                  mostly spent sitting still, charging.
                </p>
              </div>
            )}

            {marks.length > 0 && (
              <div className="mt-2.5 border-t border-[var(--color-edge)] pt-2.5">
                <div className="label mb-1.5">Range and bearing</div>
                <div className="flex flex-col gap-1">
                  {marks.map((m, i) => (
                    <div key={m.name} className="flex items-baseline justify-between gap-2">
                      <span
                        title={m.note}
                        className="truncate text-[10px] text-[var(--color-ink-dim)]"
                      >
                        {m.name}
                      </span>
                      <span
                        data-tm={`lm${i}`}
                        className="shrink-0 text-[11px] tabular-nums text-[var(--color-ink)]"
                      >
                        —
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          {/* --- Right column: camera, vehicle, environment --- */}
          <div className="absolute right-4 top-4 flex max-h-[calc(100vh-24rem)] w-[236px] flex-col gap-1.5 overflow-y-auto">
          <Panel>
            <div className="label border-b border-[var(--color-edge)] pb-2">Mode</div>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {(["sim", "arcade"] as const).map((m, i) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`pointer-events-auto border px-1 py-1.5 text-[9px] tracking-[0.12em] transition-colors ${
                    m === mode
                      ? "border-[var(--color-amber)] text-[var(--color-amber)]"
                      : "border-[var(--color-edge)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {i + 1} {MODE_LABELS[m]}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
              {mode === "sim"
                ? "Real speed and turn rate. Time is compressed, the rover is not."
                : "It slides, and Mars gravity hangs a jump for three seconds."}
            </p>
            <button
              onClick={requestReset}
              className="pointer-events-auto mt-2 w-full border border-[var(--color-edge-strong)] px-2 py-1 text-[9px] tracking-[0.16em] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
            >
              RESET ROVER · R
            </button>
          </Panel>
          <Panel>
            <div className="flex items-center justify-between border-b border-[var(--color-edge)] pb-2">
              <span className="label">Camera</span>
              <button
                onClick={cycleView}
                className="pointer-events-auto border border-[var(--color-edge-strong)] px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
              >
                C
              </button>
            </div>

            <div className="mt-2 text-[12px] tracking-[0.08em] text-[var(--color-amber)]">
              {view.label}
            </div>
            <div className="text-[9px] text-[var(--color-ink-faint)]">{view.full}</div>

            <div className="mt-2 grid grid-cols-3 gap-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  title={v.full}
                  className={`pointer-events-auto border px-1 py-1 text-[8px] tracking-[0.08em] transition-colors ${
                    v.id === viewId
                      ? "border-[var(--color-amber)] text-[var(--color-amber)]"
                      : "border-[var(--color-edge)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {v.label.replace("HAZCAM ", "HAZ ").replace("MASTCAM ", "")}
                </button>
              ))}
            </div>

            {view.id.startsWith("mastcam") && (
              <div className="mt-2 border-t border-[var(--color-edge)] pt-2">
                <div className="label mb-1">Filter wheel</div>
                <div className="grid grid-cols-4 gap-1">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setFilter(f.id)}
                      title={f.note}
                      className={`pointer-events-auto border px-0.5 py-1 text-[8px] tracking-[0.06em] transition-colors ${
                        f.id === filterId
                          ? "border-[var(--color-amber)] text-[var(--color-amber)]"
                          : "border-[var(--color-edge)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
                      }`}
                    >
                      {f.label.split(" ")[1]}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
                  {getFilter(filterId).note}
                </p>
              </div>
            )}

            {instrument && view.baseline > 0 && (
              <button
                onClick={toggleStereo}
                className={`pointer-events-auto mt-2 w-full border px-2 py-1 text-[9px] tracking-[0.14em] transition-colors ${
                  stereo
                    ? "border-[var(--color-amber)] text-[var(--color-amber)]"
                    : "border-[var(--color-edge-strong)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
                }`}
              >
                {stereo ? "STEREO ON" : "STEREO"} · E · {(view.baseline * 100).toFixed(1)} cm
              </button>
            )}
            {instrument && (
              <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-0.5 border-t border-[var(--color-edge)] pt-2 text-[9px] text-[var(--color-ink-faint)]">
                <span>{view.fov}° FOV</span>
                <span>{view.mono ? "mono" : "colour"}</span>
                {view.fisheye && <span>fisheye</span>}
                <span>{view.aspect === 1 ? "1:1" : "4:3"}</span>
                <span>{view.mount === "mast" ? "mast" : "body-fixed"}</span>
              </div>
            )}
            <p className="mt-1.5 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
              {view.note}
              {view.mount === "mast" && " Drag to slew the mast."}
            </p>

            <div className="mt-2.5 flex items-center justify-between border-t border-[var(--color-edge)] pt-2.5">
              <div className="flex flex-col gap-0.5">
                <span className="label">Vehicle</span>
                <span className="text-[11px] text-[var(--color-ink)]">
                  {modelKind === "engineering"
                    ? "ENGINEERING MODEL"
                    : VEHICLES[modelKind].label}
                </span>
              </div>
              <button
                onClick={toggleModel}
                className="pointer-events-auto border border-[var(--color-edge-strong)] px-2 py-1 text-[9px] tracking-[0.14em] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
              >
                M
              </button>
            </div>
            <p className="mt-1.5 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
              {modelKind === "engineering"
                ? "Built from primitives — the only one whose rocker-bogie articulates."
                : `${VEHICLES[modelKind].full}. ${VEHICLES[modelKind].note}`}
            </p>
          </Panel>

          {/* --- Environment controls --- */}
          <div className="pointer-events-auto">
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="panel w-full px-3.5 py-2 text-left text-[9px] tracking-[0.16em] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
            >
              {showSettings ? "− " : "+ "}ENVIRONMENT
            </button>
            {showSettings && (
              <Panel className="mt-1.5">
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="mb-1 flex justify-between">
                      <span className="label">Time of sol</span>
                    </div>
                    <input
                      data-tm="timeSlider"
                      type="range"
                      min={0}
                      max={23.999}
                      step={0.001}
                      defaultValue={telemetry.localTime}
                      onChange={(e) => {
                        telemetry.localTime = Number(e.target.value);
                      }}
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between">
                      <span className="label">Season Ls</span>
                      <span className="text-[10px] text-[var(--color-ink-dim)]">{ls}°</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={359}
                      step={1}
                      value={ls}
                      onChange={(e) => setLs(Number(e.target.value))}
                    />
                  </div>
                  {mode === "sim" && (
                    <div>
                      <div className="mb-1 flex justify-between">
                        <span className="label">Time compression</span>
                        <span className="text-[10px] text-[var(--color-ink-dim)]">
                          ×{timeCompression}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={400}
                        step={1}
                        value={timeCompression}
                        onChange={(e) => setTimeCompression(Number(e.target.value))}
                      />
                      <p className="mt-1 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
                        The rover always drives at {MARS.roverTopSpeed * 100} cm/s — its
                        real top speed. This runs the clock, the sun and the vehicle
                        together at ×{timeCompression}, so you are watching a time-lapse
                        rather than a rover that has been made fast. Turning in place
                        takes {(360 / ((SIM_TURN_RATE * 180) / Math.PI) / 60).toFixed(0)}{" "}
                        minutes for a full circle.
                      </p>
                    </div>
                  )}
                </div>
              </Panel>
            )}
          </div>
          </div>
          {/* --- Vehicle --- */}
          <Panel className="absolute bottom-4 right-4 w-[248px]">
            <div className="label border-b border-[var(--color-edge)] pb-2">
              Attitude and suspension
            </div>

            <div className="mt-2.5 grid grid-cols-4 gap-2">
              <Field label="Pitch" id="pitch" />
              <Field label="Roll" id="roll" />
              <Field label="Grade" id="grade" />
              <Field label="Tilt" id="tilt" />
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[var(--color-edge)] pt-2.5">
              <Field label="Rocker L" id="rockL" />
              <Field label="Rocker R" id="rockR" />
              <Field label="Bogie L" id="bogL" />
              <Field label="Bogie R" id="bogR" />
            </div>

            <div className="mt-2.5 border-t border-[var(--color-edge)] pt-2.5">
              <div className="label mb-1.5">Wheel motor current</div>
              <div className="flex flex-col gap-[3px]">
                {["LF", "LM", "LR", "RF", "RM", "RR"].map((w, i) => (
                  <div key={w} className="flex items-center gap-2">
                    <span className="w-5 text-[9px] text-[var(--color-ink-faint)]">{w}</span>
                    <div className="h-[3px] flex-1 bg-[rgba(226,148,92,0.14)]">
                      <div
                        data-tm={`cur${i}`}
                        className="h-full transition-[width] duration-100"
                        style={{ width: "0%", background: "var(--color-signal)" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>


          {/* --- Controls --- */}
          {showHelp && (
            <Panel className="pointer-events-auto absolute bottom-4 left-1/2 w-[430px] -translate-x-1/2">
              <div className="flex items-start justify-between gap-4">
                <div className="grid flex-1 grid-cols-2 gap-x-5 gap-y-1 text-[10px] text-[var(--color-ink-dim)]">
                  <span>
                    <b className="text-[var(--color-ink)]">W / S</b> drive
                  </span>
                  <span>
                    <b className="text-[var(--color-ink)]">A / D</b> steer
                  </span>
                  <span>
                    <b className="text-[var(--color-ink)]">A / D</b> alone — turn in place
                  </span>
                  <span>
                    <b className="text-[var(--color-ink)]">Shift</b>{" "}
                    {mode === "arcade" ? "boost" : "faster"}
                  </span>
                  <span>
                    <b className="text-[var(--color-ink)]">Space</b>{" "}
                    {mode === "arcade" ? "jump" : "brake"}
                  </span>
                  {mode === "arcade" && (
                    <span>
                      <b className="text-[var(--color-ink)]">X</b> handbrake
                    </span>
                  )}
                  {mode === "arcade" && (
                    <span>
                      <b className="text-[var(--color-ink)]">R</b> reset
                    </span>
                  )}
                  <span>
                    <b className="text-[var(--color-ink)]">1 / 2</b> sim / arcade
                  </span>
                  <span>
                    <b className="text-[var(--color-ink)]">G</b> traverse ·{" "}
                    <b className="text-[var(--color-ink)]">E</b> stereo
                  </span>
                  <span>
                    <b className="text-[var(--color-ink)]">C</b> next camera ·{" "}
                    <b className="text-[var(--color-ink)]">M</b> model ·{" "}
                    <b className="text-[var(--color-ink)]">T</b> clock ·{" "}
                    <b className="text-[var(--color-ink)]">H</b> hide
                  </span>
                </div>
                <button
                  onClick={toggleHelp}
                  className="shrink-0 text-[9px] tracking-[0.14em] text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                >
                  ✕
                </button>
              </div>
              <p className="mt-2 border-t border-[var(--color-edge)] pt-2 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
                Terrain from MOLA laser altimetry at {Math.abs(GALE.latitude).toFixed(2)}°S{" "}
                {GALE.longitude.toFixed(2)}°E. Everything on the horizon is measured.
              </p>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
