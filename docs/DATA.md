# Where the data comes from

Everything in this project is either measured or labelled as invented. This is
the ledger of which is which, and how to reproduce the measured parts.

## Terrain — MOLA

`public/terrain/gale-mola.bin` · `gale-mola.json`

A 415 km window centred on Bradbury Landing, cut from the Mars Orbiter Laser
Altimeter's gridded record. MOLA flew on Mars Global Surveyor and fired nearly
600 million shots at the surface between 1997 and 2001.

- Product: `MGS-M-MOLA-5-MEGDR-L3-V1.0`, tile `MEGT00N090HB`
- Resolution: 128 pixels per degree, about 463 m per post
- Format: PDS3, raw, MSB signed 16-bit, metres relative to the areoid

The window is 897 × 897 posts. Elevation at the origin reads −4509 m; Bradbury
Landing's actual elevation is about −4500 m, which is the check that the
georeferencing is right.

```bash
python3 -m venv .venv-tools && ./.venv-tools/bin/pip install numpy pillow
mkdir -p .data
# ~21 MB: only the rows of the tile that cover Gale, via an HTTP range request
curl -r 5598720-26265599 \
  "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt00n090hb.img" \
  -o .data/gale_band.raw
./.venv-tools/bin/python tools/extract_mola.py
```

It ships as a raw `uint16` buffer rather than a PNG because browsers quietly
truncate 16-bit PNGs to 8 bits in canvas, which would quantise 6.6 km of relief
into 20 m steps and visibly terrace Mount Sharp.

## Traverse — MMGIS

`public/terrain/msl-traverse.json`

Curiosity's localised positions: 1,371 places the rover actually stopped, sol 3
to sol 4977, 37.99 km driven, ending 14.1 km from the landing site at bearing
193° and a kilometre up Mount Sharp. Consecutive points are never more than
129 m apart, so nothing is interpolated.

```bash
curl -o .data/msl_waypoints.json \
  "https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json"
./.venv-tools/bin/python tools/extract_traverse.py
```

## Rover meshes

`public/models/curiosity.glb` · `perseverance.glb`

NASA/JPL-Caltech's published models, recompressed for the web with
`@gltf-transform/cli` (WebP textures at 1024, meshopt geometry). Curiosity goes
11.86 MB → 1.06 MB, Perseverance 11.69 MB → 2.7 MB.

Neither ships a usable hierarchy for driving. `tools/segment_rover.py` runs
connected-component analysis over the geometry, which is how the wheels were
found: Curiosity's six are separate shells sharing one material that nothing
else uses; Perseverance keeps all six inside a single `Wheels_objs` node. Both
are lifted out at load time and hung on their own pivots.

Measured from the meshes, not assumed: Curiosity's wheels are 0.50 m across,
Perseverance's 0.525 m — the real redesign after Curiosity's wheels tore.

One trap: recompressing applies `KHR_mesh_quantization`, which stores positions
as normalised 16-bit integers with a compensating scale on the node. The
renderer understands that; manual geometry surgery does not, and reading the raw
arrays yields wheels 65,000 units across. Everything is denormalised through
`getX`/`getY`/`getZ` first.

## Camera optics

Fields of view are derived from published detector sizes and instantaneous
fields of view rather than quoted as round numbers:

| Instrument | Detector | IFOV | Field of view |
|---|---|---|---|
| Mastcam M-34 | 1600 × 1200 | 218 µrad | 20.0° × 15.0° |
| Mastcam M-100 | 1600 × 1200 | 74 µrad | 6.8° × 5.1° |
| Navcam | 1024 × 1024 | 820 µrad | 45° square |
| Hazcam | 1024 × 1024 | fisheye | 124° square |
| ChemCam RMI | 1024 × 1024 | 20 mrad | 1.15°, circular |
| MARDI | 1600 × 1200 | 760 µrad | 70.0° × 52.3° |

Stereo baselines: Navcam 42.4 cm, Mastcam 24.2 cm. The Hazcam figure is
approximate. Mount positions are placed from published rover dimensions and the
geometry of these meshes, not from flight CAD.

## Surface colour

The terrain's four albedo constants were measured from PIA25175
(NASA/JPL-Caltech/MSSS), a Curiosity Mastcam frame of Gale, sampled at the
25th/50th/75th luminance percentiles of the ground region. That product is white
balanced, so it approximates *reflectance* — the Martian illuminant is supplied
separately by the sun colour, which is the physically correct way round.

The result: R/G is only 1.20 in sRGB and saturation about 0.13. The real surface
is a mildly warm grey-brown, far less saturated than Mars is usually drawn.

## What is not real

Stated plainly, because the rest of this document claims a lot:

- **Everything below ~460 m in scale.** MOLA resolves nothing finer, and the
  rover is 3 m long, so the metre-to-hundred-metre roughness, the aeolian
  ripples and the clast field are all procedural.
- **The rock field.** Sizes follow a power law because real clast populations
  do, but the placement, shapes and per-stone colours are generated.
- **Wind streaks, dust shelter and bedrock outcrop.** Plausible, not mapped.
- **No orbital imagery is draped on the terrain.** The colour is a model.
- **Arcade mode.** Entirely invented apart from the gravity.
- **Curiosity's camera suite is shown while driving Perseverance.** Perseverance
  carries Mastcam-Z and SuperCam RMI and no MARDI, so those labels are wrong for
  it. Per-vehicle camera suites are unbuilt.
