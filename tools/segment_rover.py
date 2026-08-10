"""
Find the rigid sub-assemblies in NASA's Curiosity mesh.

The published GLB is a single fused node with no hierarchy, so nothing can be
articulated as shipped. But CAD-derived meshes usually keep each rigid part as
its own connected shell, so welding vertices by position and running a
union-find over shared edges should recover the real parts.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from glb import Glb  # noqa: E402

SRC = Path(__file__).parent.parent / ".data" / "curiosity.glb"
WELD = 1e-4  # metres


def main() -> None:
    g = Glb(SRC)
    node = g.json["nodes"][0]
    trans = np.array(node.get("translation", [0, 0, 0]), dtype=np.float64)

    all_pos = []
    all_tris = []
    tri_mat = []
    base = 0
    for _, name, pos, idx in g.primitives():
        all_pos.append(pos + trans)
        tris = idx.reshape(-1, 3) + base
        all_tris.append(tris)
        tri_mat.extend([name] * len(tris))
        base += len(pos)

    pos = np.vstack(all_pos)
    tris = np.vstack(all_tris)
    tri_mat = np.array(tri_mat)
    print(f"{len(pos)} verts, {len(tris)} tris, {len(set(tri_mat))} materials")

    # Weld by quantised position so parts split across primitives still join.
    q = np.round(pos / WELD).astype(np.int64)
    _, weld = np.unique(q, axis=0, return_inverse=True)
    print(f"welded to {weld.max() + 1} unique positions")

    # Union-find over welded triangle corners.
    parent = np.arange(weld.max() + 1)

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    w = weld[tris]
    for a, b, c in w:
        union(a, b)
        union(b, c)

    roots = np.array([find(i) for i in range(len(parent))])
    tri_root = roots[w[:, 0]]

    uniq, counts = np.unique(tri_root, return_counts=True)
    order = np.argsort(-counts)
    print(f"\n{len(uniq)} connected components; largest 22:\n")
    print(f"{'tris':>7} {'cx':>7} {'cy':>7} {'cz':>7} {'sx':>6} {'sy':>6} {'sz':>6}  materials")
    for i in order[:22]:
        root = uniq[i]
        sel = tri_root == root
        vs = pos[np.unique(tris[sel])]
        lo, hi = vs.min(0), vs.max(0)
        c = (lo + hi) / 2
        s = hi - lo
        mats = ",".join(sorted(set(tri_mat[sel])))[:34]
        print(
            f"{counts[i]:7d} {c[0]:7.3f} {c[1]:7.3f} {c[2]:7.3f} "
            f"{s[0]:6.3f} {s[1]:6.3f} {s[2]:6.3f}  {mats}"
        )

    small = counts[order[22:]].sum() if len(order) > 22 else 0
    print(f"\n(+{len(order) - 22} smaller components, {small} tris total)")


if __name__ == "__main__":
    main()
