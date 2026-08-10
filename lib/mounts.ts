import type * as THREE from "three";

/**
 * Live scene objects the camera rig needs to attach to. Populated by the
 * rover as it mounts; read every frame by the camera, which is why these are
 * plain mutable references rather than React state.
 */
export const mounts = {
  /** Remote sensing mast head — where Navcam and Mastcam actually sit. */
  mastHead: null as THREE.Object3D | null,
  /** Rover root, for chase and orbit framing. */
  root: null as THREE.Object3D | null,
  /** Hull, which the body-mounted Hazcams and MARDI are bolted to. */
  chassis: null as THREE.Object3D | null,
};

/**
 * Mast pointing, radians. The real mast pans and tilts under its own
 * actuators, so dragging in a camera view aims the head rather than the
 * camera — the mast head mesh moves with the view.
 */
export const mast = { pan: 0, tilt: 0 };

export const MAST_LIMITS = {
  /** The real mast pans a full turn; tilt is limited by the hardware. */
  tiltMin: -1.15,
  tiltMax: 0.75,
};
