"use client";

import { useEffect, useState } from "react";

import { getView } from "@/lib/cameras";
import { capture } from "@/lib/capture";
import { getFilter } from "@/lib/filters";
import { formatLTST } from "@/lib/mars";
import { beginPanorama, cancelPanorama, pano } from "@/lib/panorama";
import { telemetry, useUi } from "@/lib/store";

/**
 * Imaging controls.
 *
 * Deliberately its own bar across the top rather than another row inside the
 * camera panel: that column is height-capped and scrolls, so on a short window
 * these ended up below the fold and effectively did not exist.
 */
export function Imaging() {
  const viewId = useUi((s) => s.view);
  const filterId = useUi((s) => s.filter);
  const showHud = useUi((s) => s.showHud);
  const view = getView(viewId);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [strip, setStrip] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [meta, setMeta] = useState({ sweep: 0, tiles: 0, instrument: "", sol: 0 });

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (pano.active) {
        setBusy(true);
        setProgress(pano.tiles ? pano.index / pano.tiles : 0);
      } else if (busy) {
        setBusy(false);
        if (pano.result) {
          setStrip(pano.result.toDataURL("image/png"));
          setMeta({
            sweep: Math.round(pano.sweepDeg),
            tiles: pano.tiles,
            instrument: pano.instrument,
            sol: telemetry.sol,
          });
          pano.result = null;
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [busy]);

  const instrument = view.mount !== "external";
  if (!showHud) return null;

  const shoot = () => {
    capture.label = {
      instrument: view.full,
      sol: telemetry.sol,
      ltst: formatLTST(telemetry.localTime),
      fov: `${view.fov}° FOV`,
      filter: view.id.startsWith("mastcam") ? getFilter(filterId).label : "",
    };
    capture.onReady = (url) => setFrame(url);
    capture.pending = true;
  };

  return (
    <>
      {instrument && (
        <div className="pointer-events-auto absolute left-1/2 top-4 -translate-x-1/2">
          {busy ? (
            <div className="panel px-4 py-2 text-center">
              <div className="text-[10px] tracking-[0.18em] text-[var(--color-amber)]">
                MOSAIC · FRAME {pano.index + 1} OF {pano.tiles}
              </div>
              <div className="mt-1 text-[9px] text-[var(--color-ink-faint)]">
                A rover cannot take a wide picture. It takes a lot of narrow ones.
              </div>
              <div className="mt-1.5 h-[2px] w-[280px] bg-[rgba(226,148,92,0.18)]">
                <div
                  className="h-full bg-[var(--color-amber)]"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <button
                onClick={cancelPanorama}
                className="mt-1.5 text-[9px] tracking-[0.14em] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
              >
                CANCEL
              </button>
            </div>
          ) : (
            <div className="panel flex items-center gap-2 px-3 py-2">
              <span className="label">Imaging</span>
              <button
                onClick={shoot}
                className="border border-[var(--color-edge-strong)] px-2.5 py-1 text-[9px] tracking-[0.14em] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
              >
                CAPTURE
              </button>
              {view.mount === "mast" && (
                <button
                  onClick={() => beginPanorama(view)}
                  className="border border-[var(--color-edge-strong)] px-2.5 py-1 text-[9px] tracking-[0.14em] text-[var(--color-ink-dim)] transition-colors hover:text-[var(--color-ink)]"
                >
                  PANORAMA
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {frame && (
        <div className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-6">
          <div className="flex max-h-full flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={frame}
              alt="captured frame"
              className="max-h-[78vh] w-auto border border-[var(--color-edge)]"
            />
            <div className="flex gap-2">
              <a
                href={frame}
                download={`gale-sol${telemetry.sol}.png`}
                className="panel px-4 py-1.5 text-[9px] tracking-[0.16em] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
              >
                DOWNLOAD
              </a>
              <button
                onClick={() => setFrame(null)}
                className="panel px-4 py-1.5 text-[9px] tracking-[0.16em] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {strip && (
        <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-20">
          <div className="panel border-x-0 border-b-0 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <span className="text-[11px] tracking-[0.16em] text-[var(--color-amber)]">
                  {meta.instrument} MOSAIC
                </span>
                <span className="ml-3 text-[9px] text-[var(--color-ink-faint)]">
                  {meta.tiles} frames · {meta.sweep}° · sol {meta.sol} · scroll to pan
                </span>
              </div>
              <div className="flex gap-2">
                <a
                  href={strip}
                  download={`gale-mosaic-sol${meta.sol}.png`}
                  className="border border-[var(--color-edge-strong)] px-3 py-1 text-[9px] tracking-[0.14em] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
                >
                  DOWNLOAD
                </a>
                <button
                  onClick={() => setStrip(null)}
                  className="border border-[var(--color-edge-strong)] px-3 py-1 text-[9px] tracking-[0.14em] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
                >
                  CLOSE
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={strip}
                alt="panorama"
                className="h-[240px] max-w-none border border-[var(--color-edge)]"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
