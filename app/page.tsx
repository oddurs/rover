"use client";

import { useCallback, useState } from "react";

import { GradePanel } from "@/components/GradePanel";
import { Hud } from "@/components/Hud";
import { Insignia } from "@/components/Insignia";
import { Scene } from "@/components/Scene";
import { BRAND } from "@/lib/brand";

export default function Home() {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#0b0705]">
      <Scene onReady={onReady} />
      <Hud ready={ready} />
      <GradePanel />

      {/*
        The boot card. Everything the agency wants you to know about itself is
        here, because it is the one moment nobody is driving: the badge, who
        they claim to be, the mission, and the admission that they are not real.
      */}
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0b0705] px-6">
          <div className="flex w-[380px] flex-col">
            <div className="flex items-center gap-3.5">
              <Insignia size={54} />
              <div className="flex flex-col gap-1">
                <h1 className="text-[12px] leading-none tracking-[0.2em] text-[var(--color-ink)]">
                  {BRAND.agency.toUpperCase()}
                </h1>
                <span className="text-[9px] leading-none tracking-[0.22em] text-[var(--color-ink-faint)]">
                  {BRAND.division.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="mt-6 flex items-baseline justify-between">
              <span className="text-[13px] tracking-[0.24em] text-[var(--color-amber)]">
                GALE CRATER
              </span>
              <span className="text-[9px] tracking-[0.18em] text-[var(--color-ink-faint)]">
                {BRAND.mission}
              </span>
            </div>

            <div className="mt-2.5 h-px w-full bg-[var(--color-edge-strong)]">
              <div className="h-px w-1/3 animate-pulse bg-[var(--color-amber)]" />
            </div>

            <p className="mt-3 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
              Loading MOLA elevation model — 897 × 897 posts at 463 m, covering
              415 km around Bradbury Landing.
            </p>

            <p className="mt-6 border-t border-[var(--color-edge)] pt-2.5 text-[8px] leading-relaxed tracking-[0.1em] text-[var(--color-ink-faint)]">
              {BRAND.disclaimer.toUpperCase()}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
