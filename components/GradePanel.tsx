"use client";

import { useEffect, useRef, useState } from "react";

import { PRESETS, clearLut, grade, installLut, lut, parseCube } from "@/lib/grading";
import { LOOKS, bakeLook } from "@/lib/lutLibrary";

/**
 * Colour grading panel.
 *
 * Hidden behind the backtick key, because it is a workbench rather than part of
 * the instrument. Values are written straight into the live grade object and
 * read by the render pass on the next frame, so every slider is immediate.
 */

interface Row {
  key: keyof typeof grade;
  label: string;
  min: number;
  max: number;
  step: number;
  note?: string;
}

const ROWS: Row[] = [
  { key: "exposure", label: "Exposure", min: -2, max: 2, step: 0.01, note: "stops" },
  { key: "contrast", label: "Contrast", min: 0.5, max: 2, step: 0.01, note: "about mid grey" },
  { key: "saturation", label: "Saturation", min: 0, max: 2, step: 0.01 },
  { key: "temperature", label: "Temperature", min: -1, max: 1, step: 0.01, note: "cool ↔ warm" },
  { key: "tint", label: "Tint", min: -1, max: 1, step: 0.01, note: "magenta ↔ green" },
  { key: "lift", label: "Lift", min: -0.05, max: 0.15, step: 0.001, note: "black point" },
  { key: "toning", label: "Split toning", min: 0, max: 1, step: 0.01, note: "shadows vs highlights" },
  { key: "vignette", label: "Vignette", min: 0, max: 0.8, step: 0.01 },
  { key: "grain", label: "Grain", min: 0, max: 0.12, step: 0.002 },
  { key: "lutMix", label: "LUT mix", min: 0, max: 1, step: 0.01 },
];

function Swatch({
  label,
  which,
  onChange,
}: {
  label: string;
  which: "shadowTint" | "highlightTint";
  onChange: () => void;
}) {
  const v = grade[which];
  const hex =
    "#" +
    v
      .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0"))
      .join("");
  return (
    <label className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => {
          const h = e.target.value;
          grade[which] = [
            parseInt(h.slice(1, 3), 16) / 255,
            parseInt(h.slice(3, 5), 16) / 255,
            parseInt(h.slice(5, 7), 16) / 255,
          ];
          onChange();
        }}
        className="h-5 w-8 cursor-pointer border border-[var(--color-edge)] bg-transparent"
      />
      <span className="label">{label}</span>
    </label>
  );
}

export function GradePanel() {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const [preset, setPreset] = useState("raw");
  const [lutName, setLutName] = useState("");
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Backquote" && !e.repeat) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  const redraw = () => force((n) => n + 1);

  return (
    <div className="pointer-events-auto fixed left-4 top-4 z-40 max-h-[calc(100vh-2rem)] w-[286px] overflow-y-auto">
      <div className="panel px-3.5 py-3" style={{ background: "rgba(10,6,5,0.97)" }}>
        <div className="flex items-center justify-between border-b border-[var(--color-edge)] pb-2">
          <span className="text-[11px] tracking-[0.18em] text-[var(--color-amber)]">
            COLOUR GRADE
          </span>
          <button
            onClick={() => setOpen(false)}
            className="text-[9px] tracking-[0.14em] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
          >
            ` CLOSE
          </button>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                Object.assign(grade, p.grade);
                setPreset(p.id);
                redraw();
              }}
              className={`border px-1 py-1 text-[8px] tracking-[0.08em] transition-colors ${
                p.id === preset
                  ? "border-[var(--color-amber)] text-[var(--color-amber)]"
                  : "border-[var(--color-edge)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
          {PRESETS.find((p) => p.id === preset)?.note}
        </p>

        <div className="mt-2.5 flex flex-col gap-2 border-t border-[var(--color-edge)] pt-2.5">
          {ROWS.map((r) => (
            <div key={r.key}>
              <div className="mb-0.5 flex items-baseline justify-between">
                <span className="label">{r.label}</span>
                <span className="text-[9px] tabular-nums text-[var(--color-ink-dim)]">
                  {(grade[r.key] as number).toFixed(r.step < 0.01 ? 3 : 2)}
                  {r.note ? <span className="ml-1 text-[var(--color-ink-faint)]">{r.note}</span> : null}
                </span>
              </div>
              <input
                type="range"
                min={r.min}
                max={r.max}
                step={r.step}
                value={grade[r.key] as number}
                onChange={(e) => {
                  (grade[r.key] as number) = Number(e.target.value);
                  setPreset("");
                  redraw();
                }}
              />
            </div>
          ))}
        </div>

        <div className="mt-2 flex gap-3 border-t border-[var(--color-edge)] pt-2">
          <Swatch label="Shadows" which="shadowTint" onChange={redraw} />
          <Swatch label="Highlights" which="highlightTint" onChange={redraw} />
        </div>

        <div className="mt-2.5 border-t border-[var(--color-edge)] pt-2.5">
          <div className="label mb-1">Film looks</div>
          <div className="grid grid-cols-3 gap-1">
            {LOOKS.map((l) => (
              <button
                key={l.id}
                title={l.note}
                onClick={() => {
                  installLut(bakeLook(l), 33, l.label);
                  setLutName(l.label);
                  setErr("");
                  redraw();
                }}
                className={`border px-0.5 py-1 text-[8px] leading-tight tracking-[0.04em] transition-colors ${
                  lutName === l.label
                    ? "border-[var(--color-amber)] text-[var(--color-amber)]"
                    : "border-[var(--color-edge)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
            {LOOKS.find((l) => l.label === lutName)?.note ??
              "Baked to a 33³ cube on the spot. Set the strength with LUT mix above."}
          </p>

          <div className="label mb-1 mt-2.5">Custom LUT</div>
          <input
            ref={file}
            type="file"
            accept=".cube"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const ok = parseCube(await f.text(), f.name);
              setErr(ok ? "" : "Could not read that .cube");
              setLutName(ok ? f.name : "");
              redraw();
            }}
          />
          <div className="flex gap-1">
            <button
              onClick={() => file.current?.click()}
              className="flex-1 border border-[var(--color-edge-strong)] px-2 py-1 text-[9px] tracking-[0.14em] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
            >
              LOAD .CUBE
            </button>
            {lut.texture && (
              <button
                onClick={() => {
                  clearLut();
                  setLutName("");
                  redraw();
                }}
                className="border border-[var(--color-edge-strong)] px-2 py-1 text-[9px] tracking-[0.14em] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
              >
                CLEAR
              </button>
            )}
          </div>
          <p className="mt-1 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
            {err
              ? err
              : lutName
                ? `${lutName} · ${lut.size}³`
                : "Any Adobe .cube. Applied after the transfer function, which is where a display LUT belongs."}
          </p>
        </div>

        <button
          onClick={() => {
            navigator.clipboard?.writeText(JSON.stringify(grade, null, 2));
          }}
          className="mt-2.5 w-full border border-[var(--color-edge-strong)] px-2 py-1 text-[9px] tracking-[0.14em] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
        >
          COPY GRADE AS JSON
        </button>
      </div>
    </div>
  );
}
