"use client";

import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { GEO } from "@/lib/rover";
import { VEHICLES, type Vehicle } from "@/lib/vehicles";

/**
 * NASA/JPL-Caltech's published Curiosity model, rigged just enough to drive.
 *
 * The GLB ships as a single fused node with no hierarchy and no skins, so
 * nothing in it can move as delivered. Connected-component analysis shows the
 * six wheels *are* separate shells sharing one material, and nothing else uses
 * that material — so the wheels can be lifted out at load time and hung on
 * their own pivots. The rocker-bogie arms are not separable from the hull, so
 * on this model the suspension is rigid; the procedural engineering model is
 * the one that articulates.
 *
 * The mesh is already in metres, with the ground plane at y = 0 and axle
 * stations within 5 cm of the ones the engineering model uses.
 */

/**
 * The source models put their ground plane at y = 0, but the rover's local
 * origin is the rocker-pivot plane, 0.6 m up. Drop the mesh to match.
 */
const MODEL_Y = -GEO.rockerPivot.y;

interface Piece {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

interface Part {
  name: string;
  /** Wheel centre in model space. */
  center: THREE.Vector3;
  /**
   * A wheel is rarely one mesh. Perseverance splits tyre, hub and grousers
   * across separate materials, so a station collects however many pieces land
   * on it and they all hang off the one pivot.
   */
  pieces: Piece[];
}

/**
 * Convert an attribute to plain float32.
 *
 * The optimiser applies KHR_mesh_quantization, which stores positions as
 * normalised 16-bit integers with a compensating scale on the node. That is
 * fine for the renderer, which understands it, but any manual geometry surgery
 * has to denormalise first — reading the raw array yields values in the tens of
 * thousands. `getX`/`getY`/`getZ` denormalise for us and also see through
 * interleaved buffers.
 */
function toFloat(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const n = attr.itemSize;
  const out = new Float32Array(attr.count * n);
  for (let i = 0; i < attr.count; i++) {
    out[i * n] = attr.getX(i);
    if (n > 1) out[i * n + 1] = attr.getY(i);
    if (n > 2) out[i * n + 2] = attr.getZ(i);
    if (n > 3) out[i * n + 3] = attr.getW(i);
  }
  return new THREE.Float32BufferAttribute(out, n);
}

/** A dequantised copy of a mesh's geometry, with its world transform baked in. */
function bake(mesh: THREE.Mesh, extra: THREE.Matrix4): THREE.BufferGeometry {
  const src = mesh.geometry;
  const geo = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    geo.setAttribute(name, toFloat(attr as THREE.BufferAttribute));
  }
  const index = src.getIndex();
  geo.setIndex(index ? Array.from(index.array as ArrayLike<number>) : null);
  geo.applyMatrix4(mesh.matrixWorld);
  geo.applyMatrix4(extra);
  return geo;
}

/** Pull a triangle subset out of an indexed geometry, remapping its vertices. */
function extract(src: THREE.BufferGeometry, tris: number[]): THREE.BufferGeometry {
  const index = src.getIndex();
  if (!index) throw new Error("expected indexed geometry");

  const remap = new Map<number, number>();
  const newIndex: number[] = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const v = index.getX(t * 3 + k);
      let n = remap.get(v);
      if (n === undefined) {
        n = remap.size;
        remap.set(v, n);
      }
      newIndex.push(n);
    }
  }

  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const dst = new Float32Array(remap.size * a.itemSize);
    for (const [from, to] of remap) {
      for (let c = 0; c < a.itemSize; c++) {
        dst[to * a.itemSize + c] = a.array[from * a.itemSize + c] as number;
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(dst, a.itemSize));
  }
  out.setIndex(newIndex);
  return out;
}

interface Rig {
  body: Piece[];
  wheels: Part[];
}

function buildRig(scene: THREE.Object3D, spec: Vehicle): Rig {
  const body: Piece[] = [];
  const stations = new Map<string, { box: THREE.Box3; pieces: Piece[] }>();

  scene.updateMatrixWorld(true);

  // Which meshes hold the wheels differs by model: Curiosity's six share one
  // material that nothing else uses; Perseverance keeps all six under a single
  // named node.
  const wheelSet = new Set<THREE.Mesh>();
  if (spec.wheels.by === "node") {
    const group = scene.getObjectByName(spec.wheels.name);
    group?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) wheelSet.add(o as THREE.Mesh);
    });
  }

  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });

  const yaw = new THREE.Matrix4().makeRotationY(spec.yaw);

  for (const mesh of meshes) {
    // Bake the source node transform (the optimiser leaves a scale on it) and
    // the app's heading convention straight into the vertices.
    const geo = bake(mesh, yaw);
    geo.translate(0, MODEL_Y, 0);
    const material = mesh.material as THREE.Material;

    const isWheels =
      spec.wheels.by === "node"
        ? wheelSet.has(mesh)
        : !Array.isArray(mesh.material) &&
          (mesh.material as THREE.Material).name === spec.wheels.name;

    if (!isWheels) {
      body.push({ geometry: geo, material });
      continue;
    }

    // Split the six wheels apart by which axle station each triangle sits on.
    const index = geo.getIndex()!;
    const pos = geo.getAttribute("position");
    const buckets = new Map<string, number[]>();
    const v = new THREE.Vector3();

    for (let t = 0; t < index.count / 3; t++) {
      let cx = 0;
      let cz = 0;
      for (let k = 0; k < 3; k++) {
        v.fromBufferAttribute(pos as THREE.BufferAttribute, index.getX(t * 3 + k));
        cx += v.x / 3;
        cz += v.z / 3;
      }
      // Yawing by 180 degrees flips the sign of both x and z.
      const side = cx < 0 ? "L" : "R";
      let station = 0;
      let best = Infinity;
      spec.axleZ.forEach((z, i) => {
        const d = Math.abs(cz - -z);
        if (d < best) {
          best = d;
          station = i;
        }
      });
      const key = `${side}.spin${station}`;
      const list = buckets.get(key);
      if (list) list.push(t);
      else buckets.set(key, [t]);
    }

    for (const [name, tris] of buckets) {
      const sub = extract(geo, tris);
      sub.computeBoundingBox();
      const box = sub.boundingBox!.clone();
      const existing = stations.get(name);
      if (existing) {
        existing.box.union(box);
        existing.pieces.push({ geometry: sub, material });
      } else {
        stations.set(name, { box, pieces: [{ geometry: sub, material }] });
      }
    }
  }

  // One pivot per station, placed at the centre of everything that landed on
  // it, with each piece re-origined onto that pivot so they spin together.
  const wheels: Part[] = [];
  for (const [name, st] of stations) {
    const center = new THREE.Vector3();
    st.box.getCenter(center);
    for (const piece of st.pieces) {
      piece.geometry.translate(-center.x, -center.y, -center.z);
      piece.geometry.computeBoundingSphere();
    }
    wheels.push({ name, center, pieces: st.pieces });
  }

  return { body, wheels };
}

export function FlightModel({ vehicle }: { vehicle: Vehicle }) {
  const gltf = useGLTF(vehicle.url, undefined, undefined, (loader) => {
    loader.setMeshoptDecoder(MeshoptDecoder);
  });

  const rig = useMemo(() => buildRig(gltf.scene, vehicle), [gltf.scene, vehicle]);

  return (
    <group>
      {rig.body.map((p, i) => (
        <mesh
          key={i}
          geometry={p.geometry}
          material={p.material}
          castShadow
          receiveShadow
        />
      ))}

      {/* The published mesh has no mast node; give the cameras one to ride. */}
      <group name="mastHead" position={vehicle.mastHead} />

      {rig.wheels.map((w) => {
        // Front and rear corners steer; the middle pair does not.
        const corner = !w.name.endsWith("spin1");
        const steerName = w.name.replace("spin0", "steer0").replace("spin2", "steer1");
        const tag =
          w.name[0] + (w.name.endsWith("spin0") ? "F" : w.name.endsWith("spin1") ? "M" : "R");
        const wheel = (
          <group name={w.name} userData={{ wheel: tag }}>
            {w.pieces.map((piece, i) => (
              <mesh
                key={i}
                geometry={piece.geometry}
                material={piece.material}
                castShadow
                receiveShadow
              />
            ))}
          </group>
        );
        return (
          <group key={w.name} position={[w.center.x, w.center.y, w.center.z]}>
            {corner ? <group name={steerName}>{wheel}</group> : wheel}
          </group>
        );
      })}
    </group>
  );
}

for (const v of Object.values(VEHICLES)) useGLTF.preload(v.url);
