"""
Convert NASA's localised Curiosity waypoints into this app's world frame.

Source: MMGIS MSL_waypoints.json — 1,371 positions from sol 3 to sol 4977,
each one a place the rover actually stopped, with the odometry it had at the
time. Nothing here is interpolated or invented; the only transform is from
planetocentric lat/lon into metres east and south of Bradbury Landing.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / ".data" / "msl_waypoints.json"
META = ROOT / "public" / "terrain" / "gale-mola.json"
OUT = ROOT / "public" / "terrain" / "msl-traverse.json"

PX_PER_DEG = 128.0


def main() -> None:
    meta = json.loads(META.read_text())
    o = meta["origin"]
    m_lat = meta["metresPerPixelLat"] * PX_PER_DEG   # metres per degree of latitude
    m_lon = meta["metresPerPixelLon"] * PX_PER_DEG

    feats = json.loads(SRC.read_text())["features"]
    pts = []
    for f in feats:
        lon, lat = f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1]
        p = f["properties"]
        pts.append(
            {
                # +X east, +Z south, origin at Bradbury Landing.
                "x": round((lon - o["lon"]) * m_lon, 2),
                "z": round((o["lat"] - lat) * m_lat, 2),
                "sol": p["sol"],
                "d": round(p["dist_total_m"], 1),
            }
        )

    pts.sort(key=lambda p: p["sol"])
    out = {
        "source": "NASA/JPL MMGIS MSL_waypoints.json — localised rover positions",
        "origin": "Bradbury Landing, 4.5895 S 137.4417 E",
        "sols": [pts[0]["sol"], pts[-1]["sol"]],
        "totalMetres": pts[-1]["d"],
        "count": len(pts),
        "points": pts,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")

    span_x = max(p["x"] for p in pts) - min(p["x"] for p in pts)
    span_z = max(p["z"] for p in pts) - min(p["z"] for p in pts)
    far = max((p["x"] ** 2 + p["z"] ** 2) ** 0.5 for p in pts)
    print(f"{len(pts)} waypoints, sol {out['sols'][0]}..{out['sols'][1]}")
    print(f"driven      {out['totalMetres'] / 1000:.2f} km")
    print(f"extent      {span_x / 1000:.2f} x {span_z / 1000:.2f} km")
    print(f"furthest    {far / 1000:.2f} km from the landing site")
    print(f"file        {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
