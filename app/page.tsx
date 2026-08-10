"use client";

import { useCallback, useState } from "react";

import { Hud } from "@/components/Hud";
import { Scene } from "@/components/Scene";

export default function Home() {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#0b0705]">
      <Scene onReady={onReady} />
      <Hud ready={ready} />

      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0b0705]">
          <div className="flex w-[320px] flex-col gap-3">
            <div className="text-[11px] tracking-[0.22em] text-[var(--color-amber)]">
              GALE CRATER
            </div>
            <div className="h-px w-full bg-[var(--color-edge-strong)]">
              <div className="h-px w-1/3 animate-pulse bg-[var(--color-amber)]" />
            </div>
            <p className="text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
              Loading MOLA elevation model — 897 × 897 posts at 463 m, covering
              415 km around Bradbury Landing.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
