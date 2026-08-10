"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { getView } from "@/lib/cameras";
import { MAST_LIMITS, mast, mounts } from "@/lib/mounts";
import { useUi } from "@/lib/store";

const CHASE_OFFSET = new THREE.Vector3(0, 3.0, 7.2);

/**
 * Puts the camera where the selected instrument actually is.
 *
 * Mast instruments ride the mast head, so slewing the mast moves them exactly
 * as it moves the real ones. Body instruments are bolted to the hull and do
 * not slew at all — the Hazcams point where the rover points, which is rather
 * the idea of them.
 */
export function CameraRig() {
  const gl = useThree((s) => s.gl);
  const viewId = useUi((s) => s.view);
  const view = getView(viewId);

  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const prevRover = useRef(new THREE.Vector3());
  const seeded = useRef(false);

  const tmpVec = useMemo(() => new THREE.Vector3(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const aimQuat = useMemo(() => new THREE.Quaternion(), []);
  const aimEuler = useMemo(() => new THREE.Euler(0, 0, 0, "YXZ"), []);

  // Dragging slews the mast — but only for instruments that ride it.
  useEffect(() => {
    if (view.mount !== "mast") return;
    const el = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      // Scale by field of view, so a narrow optic slews proportionally slower.
      const k = (view.fov / 45) * 0.0042;
      mast.pan -= (e.clientX - lastX) * k;
      mast.tilt = THREE.MathUtils.clamp(
        mast.tilt - (e.clientY - lastY) * k,
        MAST_LIMITS.tiltMin,
        MAST_LIMITS.tiltMax
      );
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [view, gl]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const cam = state.camera;

    const dbg = (window as unknown as { rover?: Record<string, unknown> }).rover;
    if (dbg) dbg.camera = cam;

    const root = mounts.root;
    if (!root) return;
    const rp = root.position;

    if (!seeded.current) {
      prevRover.current.copy(rp);
      cam.position.set(rp.x + 6, rp.y + 4, rp.z + 8);
      seeded.current = true;
    }

    if (view.mount === "external") {
      if (viewId === "orbit") {
        // Carry the camera along with the rover so the orbit stays framed.
        cam.position.add(prevRover.current.clone().sub(rp).negate());
        const c = controls.current;
        if (c) {
          c.target.set(rp.x, rp.y + 0.5, rp.z);
          c.update();
        }
      } else {
        const desired = CHASE_OFFSET.clone().applyQuaternion(root.quaternion).add(rp);
        cam.position.lerp(desired, 1 - Math.exp(-dt * 3.5));
        cam.lookAt(rp.x, rp.y + 0.8, rp.z);
      }
    } else if (view.mount === "mast") {
      const head = mounts.mastHead;
      if (head) {
        head.updateWorldMatrix(true, false);
        head.getWorldPosition(cam.position);
        head.getWorldQuaternion(cam.quaternion);
        cam.translateX(view.offset[0]);
        cam.translateY(view.offset[1]);
        cam.translateZ(view.offset[2]);
      }
    } else {
      const body = mounts.chassis;
      if (body) {
        body.updateWorldMatrix(true, false);
        tmpVec
          .set(view.offset[0], view.offset[1], view.offset[2])
          .applyMatrix4(body.matrixWorld);
        cam.position.copy(tmpVec);
        body.getWorldQuaternion(tmpQuat);
        aimEuler.set(view.aim[0], view.aim[1], 0, "YXZ");
        aimQuat.setFromEuler(aimEuler);
        cam.quaternion.copy(tmpQuat).multiply(aimQuat);
      }
    }

    prevRover.current.copy(rp);
  });

  return viewId === "orbit" ? (
    <OrbitControls
      ref={controls}
      enablePan={false}
      minDistance={3.5}
      maxDistance={260}
      // Stop just short of the horizon so you never orbit under the ground.
      maxPolarAngle={Math.PI * 0.495}
      enableDamping
      dampingFactor={0.08}
    />
  ) : null;
}
