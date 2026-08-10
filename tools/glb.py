"""Minimal glTF-binary reader. Enough to pull geometry out and put it back."""

import base64
import json
import struct
from pathlib import Path

import numpy as np

COMPONENT = {
    5120: ("<i1", 1),
    5121: ("<u1", 1),
    5122: ("<i2", 2),
    5123: ("<u2", 2),
    5125: ("<u4", 4),
    5126: ("<f4", 4),
}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class Glb:
    def __init__(self, path: Path):
        raw = path.read_bytes()
        magic, _, _ = struct.unpack_from("<4sII", raw, 0)
        assert magic == b"glTF", "not a GLB"

        self.json = None
        self.bin = b""
        off = 12
        while off < len(raw):
            clen, ctype = struct.unpack_from("<I4s", raw, off)
            chunk = raw[off + 8 : off + 8 + clen]
            if ctype == b"JSON":
                self.json = json.loads(chunk)
            elif ctype.strip(b"\x00") == b"BIN":
                self.bin = chunk
            off += 8 + clen + (-clen % 4)

    def buffer(self, index: int) -> bytes:
        buf = self.json["buffers"][index]
        uri = buf.get("uri")
        if uri is None:
            return self.bin
        if uri.startswith("data:"):
            return base64.b64decode(uri.split(",", 1)[1])
        raise NotImplementedError("external buffers not supported")

    def accessor(self, index: int) -> np.ndarray:
        a = self.json["accessors"][index]
        dtype, size = COMPONENT[a["componentType"]]
        n = NCOMP[a["type"]]
        count = a["count"]

        bv = self.json["bufferViews"][a["bufferView"]]
        data = self.buffer(bv.get("buffer", 0))
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride") or size * n

        if stride == size * n:
            arr = np.frombuffer(data, dtype=dtype, count=count * n, offset=start)
            return arr.reshape(count, n)

        # Interleaved: gather element by element.
        out = np.empty((count, n), dtype=dtype)
        for i in range(count):
            o = start + i * stride
            out[i] = np.frombuffer(data, dtype=dtype, count=n, offset=o)
        return out

    def primitives(self):
        """Yield (primitive_index, material_name, positions, indices)."""
        mats = self.json.get("materials", [])
        k = 0
        for mesh in self.json["meshes"]:
            for prim in mesh["primitives"]:
                pos = self.accessor(prim["attributes"]["POSITION"]).astype(np.float64)
                if "indices" in prim:
                    idx = self.accessor(prim["indices"]).reshape(-1).astype(np.int64)
                else:
                    idx = np.arange(len(pos), dtype=np.int64)
                name = (
                    mats[prim["material"]].get("name", f"mat{prim['material']}")
                    if "material" in prim
                    else "none"
                )
                yield k, name, pos, idx
                k += 1
