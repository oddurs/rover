"use client";

import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";
import * as THREE from "three";

import { CameraRig } from "@/components/CameraRig";
import { Optics } from "@/components/Optics";
import { Rocks } from "@/components/Rocks";
import { Rover } from "@/components/Rover";
import { Sky } from "@/components/Sky";
import { Sun } from "@/components/Sun";
import { Terrain } from "@/components/Terrain";
import { mounts } from "@/lib/mounts";
import { telemetry } from "@/lib/store";
import { loadMola, sampleHeight, type MolaMeta } from "@/lib/terrain";
import { molaTexture, shared } from "@/lib/uniforms";

function World() {
  return (
    <>
      <Sun />
      <Sky />
      <Terrain />
      <Rover />
      <Rocks />
      {/* Last, so it reads a rover pose that is already up to date. */}
      <CameraRig />
      {/* Takes over the render loop; must come after everything else. */}
      <Optics />
    </>
  );
}

export function Scene({ onReady }: { onReady?: (meta: MolaMeta) => void }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadMola()
      .then(({ meta, data }) => {
        if (cancelled) return;
        const range = meta.elevationMax - meta.elevationMin;
        shared.uMola.value = molaTexture(data, meta.size, meta.elevationMin, range);
        shared.uMolaSize.value = meta.size;
        shared.uElevMin.value = meta.elevationMin;
        shared.uElevRange.value = range;
        shared.uMolaOriginPx.value.set(meta.origin.pixelCol, meta.origin.pixelRow);
        shared.uMetresPerPx.value.set(meta.metresPerPixelLon, meta.metresPerPixelLat);
        // Small inspection hook: handy for probing wheel contact and pose
        // from the console or a headless browser.
        (window as unknown as { rover: unknown }).rover = {
          telemetry,
          mounts,
          sampleHeight,
          meta,
        };
        setStatus("ready");
        onReady?.(meta);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setMessage(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [onReady]);

  if (status === "error") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#0d0806] p-8 text-center">
        <p className="max-w-md font-mono text-sm text-[#c98a5e]">
          Could not load the Gale Crater elevation model.
          <br />
          <span className="text-[#7a5a44]">{message}</span>
        </p>
      </div>
    );
  }

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      // Far enough to see the crater rim ~75 km out; near enough that the
      // mast cameras don't clip the rover's own deck.
      camera={{ fov: 55, near: 0.12, far: 50000, position: [8, 5, 10] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.shadowMap.type = THREE.PCFShadowMap;
      }}
    >
      {status === "ready" && <World />}
    </Canvas>
  );
}
