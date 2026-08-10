"""
Extract a Gale Crater elevation window from MOLA MEGDR and emit a web-ready heightfield.

Source: MGS MOLA MEGDR meg128 tile MEGT00N090HB.IMG
  - PDS3, raw (no header), MSB signed int16, metres relative to the areoid
  - 5632 lines x 11520 samples, simple cylindrical
  - 128 px/deg  ->  463 m/px at the equator
  - covers lat 0..-44, lon 90..180 (east-positive, planetocentric, IAU2000)

We range-fetched only the row band covering the window, so .data/gale_band.raw
starts at absolute row ROW0 of the full tile.

Output is a raw little-endian uint16 buffer rather than a PNG: browsers decode
16-bit PNGs down to 8 bits in canvas, which would quantise ~5 km of relief into
~20 m steps and visibly terrace Mt Sharp.
"""

import json
import struct
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".data" / "gale_band.raw"
OUT_DIR = ROOT / "public" / "terrain"
PREVIEW = ROOT / ".data" / "gale_preview.png"

# --- Geometry of the fetched band (must match the curl range request) ---------
TILE_SAMPLES = 11520          # samples per row in the full tile
PX_PER_DEG = 128.0
MARS_RADIUS_M = 3396000.0     # A_AXIS_RADIUS from the PDS label

ROW0 = 243                    # absolute first row present in gale_band.raw
COL0 = 5670                   # absolute first column we want
SIZE = 897                    # window is SIZE x SIZE samples (~415 km)

# Tile origin, from the label: MAXIMUM_LATITUDE 0, WESTERNMOST_LONGITUDE 90
LAT0_DEG = 0.0
LON0_DEG = 90.0

# World origin: Bradbury Landing, where Curiosity touched down 2012-08-06.
ORIGIN_LAT = -4.5895
ORIGIN_LON = 137.4417


def row_to_lat(row: float) -> float:
    return LAT0_DEG - row / PX_PER_DEG


def col_to_lon(col: float) -> float:
    return LON0_DEG + col / PX_PER_DEG


def write_png_gray(path: Path, img: np.ndarray) -> None:
    """Minimal 8-bit greyscale PNG writer (preview only, keeps deps light)."""
    h, w = img.shape
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    band = np.fromfile(RAW, dtype=">i2")
    rows = band.size // TILE_SAMPLES
    band = band[: rows * TILE_SAMPLES].reshape(rows, TILE_SAMPLES)

    r = COL0 - 0  # noqa: F841  (clarity: columns are absolute in the full row)
    win = band[0:SIZE, COL0 : COL0 + SIZE].astype(np.float32)

    lo = float(win.min())
    hi = float(win.max())

    # Ground sample distance. Simple cylindrical: latitude spacing is constant,
    # longitude spacing shrinks by cos(lat). At ~5S that is a 0.4% difference,
    # so a single scalar is well within the noise of a 463 m dataset.
    centre_lat = row_to_lat(ROW0 + SIZE / 2)
    m_per_px_lat = MARS_RADIUS_M * (np.pi / 180.0) / PX_PER_DEG
    m_per_px_lon = m_per_px_lat * float(np.cos(np.radians(centre_lat)))

    # Where the world origin (Bradbury Landing) sits inside the window.
    origin_row = (LAT0_DEG - ORIGIN_LAT) * PX_PER_DEG - ROW0
    origin_col = (ORIGIN_LON - LON0_DEG) * PX_PER_DEG - COL0

    quant = np.clip(np.round((win - lo) / (hi - lo) * 65535.0), 0, 65535)
    quant = quant.astype("<u2")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "gale-mola.bin").write_bytes(quant.tobytes())

    meta = {
        "source": "MGS MOLA MEGDR meg128 / MEGT00N090HB.IMG (NASA PDS Geosciences Node)",
        "note": "Elevation in metres relative to the Mars areoid (GMM3).",
        "size": SIZE,
        "format": "uint16-le",
        "elevationMin": lo,
        "elevationMax": hi,
        "metresPerPixelLat": m_per_px_lat,
        "metresPerPixelLon": m_per_px_lon,
        "bounds": {
            "north": row_to_lat(ROW0),
            "south": row_to_lat(ROW0 + SIZE),
            "west": col_to_lon(COL0),
            "east": col_to_lon(COL0 + SIZE),
        },
        # World space: +X east, +Z south, +Y up; origin at Bradbury Landing.
        "origin": {
            "name": "Bradbury Landing",
            "lat": ORIGIN_LAT,
            "lon": ORIGIN_LON,
            "pixelRow": origin_row,
            "pixelCol": origin_col,
            "elevation": float(
                win[int(round(origin_row)), int(round(origin_col))]
            ),
        },
    }
    (OUT_DIR / "gale-mola.json").write_text(json.dumps(meta, indent=2) + "\n")

    # --- hillshade preview so we can eyeball that Gale is actually in frame ---
    gy, gx = np.gradient(win, m_per_px_lat, m_per_px_lon)
    # light from the northwest, fairly low
    az, alt = np.radians(315.0), np.radians(35.0)
    nz = 1.0 / np.sqrt(gx * gx + gy * gy + 1.0)
    nx, ny = -gx * nz, -gy * nz
    shade = nx * np.cos(alt) * np.sin(az) + ny * np.cos(alt) * np.cos(az) + nz * np.sin(alt)
    shade = np.clip(shade, 0, 1)
    tint = (win - lo) / (hi - lo)
    img = np.clip(shade * 0.75 + tint * 0.35, 0, 1)
    write_png_gray(PREVIEW, (img * 255).astype(np.uint8))

    print(f"window        {SIZE}x{SIZE} px")
    print(f"elevation     {lo:.0f} .. {hi:.0f} m  (relief {hi - lo:.0f} m)")
    print(f"ground extent {SIZE * m_per_px_lon / 1000:.1f} km E-W")
    print(f"              {SIZE * m_per_px_lat / 1000:.1f} km N-S")
    print(f"lat           {meta['bounds']['north']:.3f} .. {meta['bounds']['south']:.3f}")
    print(f"lon           {meta['bounds']['west']:.3f} .. {meta['bounds']['east']:.3f}")
    print(f"origin px     row {origin_row:.1f}, col {origin_col:.1f}")
    print(f"origin elev   {meta['origin']['elevation']:.0f} m")
    print(f"bin           {(OUT_DIR / 'gale-mola.bin').stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
