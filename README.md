# Gale Crater

A drivable Mars rover sandbox in the browser. Six-wheel rocker-bogie suspension,
a real Gale Crater height field, and Mount Sharp on the horizon where it actually
is.

No goals, no score. Drive around and look at Mars.

```bash
pnpm install
pnpm dev
```

## The terrain is real

The landform comes from **MOLA** — the laser altimeter that flew on Mars Global
Surveyor and fired nearly 600 million shots at the surface between 1997 and 2001.
`tools/extract_mola.py` pulls a 415 km window centred on Bradbury Landing out of
the MEGDR archive at NASA's PDS Geosciences Node and writes a web-ready height
field.

Everything above about 460 m in scale is measured, not invented: the crater rim
84 km to the north-north-west, the 5 km rise of Aeolis Mons 31 km to the
south-east, the slope of the crater floor under the wheels. Drive toward the
mountain and you are following the same bearing Curiosity did.

To regenerate the data from scratch:

```bash
python3 -m venv .venv-tools && ./.venv-tools/bin/pip install numpy pillow
# ~21 MB: only the rows of the MEGDR tile covering Gale
curl -r 5598720-26265599 \
  "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/megt00n090hb.img" \
  -o .data/gale_band.raw
./.venv-tools/bin/python tools/extract_mola.py
```

The output ships as a raw `uint16` buffer rather than a PNG, because browsers
quietly truncate 16-bit PNGs to 8 bits in canvas — which would quantise 6.6 km of
relief into 20 m steps and visibly terrace the mountain.

## The horizon

Mars is small — a third of Earth's radius — so the horizon is close: about
3.7 km from a two-metre eye height. The terrain is modelled on a flat plane, so
without correction the ground simply keeps going and the horizon never arrives.
The vertex stage drops the surface away as the square of the distance from the
viewer, which puts the horizon where it belongs, hides far terrain the way the
planet actually hides it, and makes distant relief rise *out* of the skyline
rather than sit on top of it. At the north rim, 84 km out, that drop is over a
kilometre — which is why the rim reads as a low ridge rather than a wall.

Aerial perspective uses its own colour rather than the sky's. The bright band
hugging the horizon and the solar disc are properties of the *sky*; painting
them onto a hillside twenty kilometres away makes far ground come out brighter
than the sky above it, which reads as fake instantly — distant relief should sit
at or just below the tone behind it.

The clipmap reaches 131 km so the rim is in the scene at all. Above the horizon
there is a distinct brighter band in the last few degrees: the line of sight
there runs through far more suspended dust than it does overhead, and that is
what stops a Mars sky reading as a plain vertical gradient.

## The ground

Modelled on Curiosity's own Mastcam frames of Gale rather than invented. Two
things are obvious in those images and neither was true of the first version of
this: the surface is a *continuous pavement* of clasts rather than a few
boulders on smooth sand, and the clasts are angular, platy fragments of broken
bedrock rather than rounded stones. Ground cover is now three tiers — gravel,
cobbles, blocks — of faceted, flattened, flat-shaded fragments, bedded into the
regolith rather than resting on it.

The palette is measured, not guessed. Sampling the ground region of PIA25175 at
the 25th/50th/75th luminance percentiles gives the terrain's four albedo
constants directly. The real surface is a mildly warm grey-brown — R/G is only
1.20 in sRGB, saturation about 0.13 — far less saturated than Mars is usually
drawn. That product is white balanced, so it approximates *reflectance*; the
Martian illuminant is supplied separately by the sun colour, which is the
physically right way round.

### What is *not* real

MOLA resolves nothing finer than 463 m per post, and the rover is 3 m long. So
everything below that scale — the metre-to-hundred-metre roughness, the aeolian
ripples, the boulder fields — is procedural, layered on top of the measured
landform. Without it a 463 m dataset reads as putty under the wheels. Rock
placement is a deterministic hash of position, so a given boulder is always in the
same place.

The dark basaltic sand and dust tinting are plausible, not mapped. There is no
orbital imagery draped over the terrain.

## Two rovers

Press **M** to swap between them.

**Flight model** — NASA/JPL-Caltech's published Curiosity mesh. It ships as a
single fused node with no hierarchy and no skins, so nothing in it can move as
delivered. Connected-component analysis (`tools/segment_rover.py`) shows the six
wheels *are* separate shells sharing one material, and nothing else uses that
material, so they get lifted out at load time and hung on their own pivots. The
rocker-bogie arms are not separable from the hull, so on this model the
suspension is rigid.

One trap worth recording: web-optimising the GLB applies `KHR_mesh_quantization`,
which stores positions as normalised 16-bit integers with a compensating scale on
the node. The renderer understands that; manual geometry surgery does not, and
reading the raw arrays yields wheels 65,000 units across. Everything is
denormalised through `getX`/`getY`/`getZ` before being touched.

11.86 MB → 1.06 MB after webp textures and meshopt.

**Engineering model** — built from primitives, and the one that actually
articulates. Watch the rocker and bogie angles in the telemetry panel move
independently as it crosses rough ground.

## The suspension

Rocker-bogie is a passive linkage: a *rocker* pivots on the chassis with the front
wheel at one end and a *bogie* at the other; the bogie carries the middle and rear
wheels. A differential bar across the hull ties the two rockers together, so the
chassis pitches to the average of the two sides and keeps all six wheels loaded
over obstacles up to about a wheel diameter tall.

It is solved **kinematically**, not with rigid-body physics: sample the ground
under each wheel, then work up the linkage to find the bogie pivot, the rocker
pivot, and finally the chassis attitude. This cannot explode, jitter, or launch the
rover into orbit, which matters more for a sandbox than simulating joint torques.
`tools/contact.mjs` measures the result — all six wheels typically sit within a
centimetre of each other on undulating ground.

The wheels are placed on the CPU while the ground is displaced on the GPU, so both
sides evaluate the same height function. `lib/noise.ts` keeps a TypeScript and a
GLSL simplex implementation in lockstep for exactly that reason.

## The sky

Mars' atmosphere is dominated by suspended dust about 1.5 microns across, which
scatters forward far more than back, and does so more strongly at short
wavelengths. The daytime sky away from the sun is therefore butterscotch — and at
sunset, looking almost straight through the forward-scattering lobe, the glow
around the sun turns **blue**. That inversion of Earth's sky is real. Scrub the
clock to about 17:50 and look west.

Solar position is computed properly from latitude, hour angle, and a declination
derived from Mars' 25.19° obliquity and the season (Ls), so shadows fall where they
should through the sol and across the Mars year.

## Rendering

A geometry clipmap: eleven concentric rings of fixed grid geometry centred on the
rover, each ring twice the cell size of the one inside it, from 0.5 m under the
wheels out to 32 km. The geometry never changes — only a centre uniform — so
roaming is free, with no mesh rebuilds to stutter on. Vertical skirts at each ring
boundary hide the cracks where resolutions meet.

The terrain is a `MeshStandardMaterial` with the height field injected into the
vertex stage rather than a bare `ShaderMaterial`. That costs some control and
buys real shadow maps: rocks and the rover lay genuine shadows across the ground,
which at low sun is most of what sells the place. One catch — a geometry with no
`normal` attribute makes three fall back to flat shading, which both facets the
terrain and removes the `vNormal` varying, so the clipmap carries placeholder
normals that the shader overwrites.

Exposure opens as the sun drops, the way an eye or a camera would; without it the
last hour before sunset just reads as muddy.

Shadow bias is worth a note: a 4096 map over a 52 m frustum is ~13 mm per texel,
tight enough that the normal bias can stay at 15 mm. A larger one visibly
detaches gravel from its own shadow, which reads as everything floating.

## Controls

| | |
|---|---|
| `W` / `S` | drive |
| `A` / `D` | steer |
| `A` / `D` with no throttle | turn in place |
| `Shift` | faster |
| `Space` | brake |
| `C` | cycle camera |
| `M` | swap flight / engineering model |
| `T` | hold the clock |
| `H` | hide telemetry |
| drag, in a mast view | slew the mast |

## Looking through the instruments

Seven of Curiosity's cameras, each with the optics of the real thing. Fields of
view come from published detector sizes and instantaneous fields of view rather
than round numbers from memory:

| | field of view | frame | |
|---|---|---|---|
| Navcam | 45° square | 1:1 | monochrome |
| Mastcam M-34 | 20° × 15° | 4:3 | colour |
| Mastcam M-100 | 6.8° × 5.1° | 4:3 | colour telephoto |
| ChemCam RMI | 1.15° | circular | monochrome |
| Front / Rear Hazcam | 124° | circular | monochrome fisheye |
| MARDI | 70° × 52° | 4:3 | colour, pointing straight down |

Frame *shape* matters as much as angle, so each view is masked to the shape its
detector actually produces — a Navcam frame is square, a Mastcam frame is 4:3 —
rather than stretched to fill a widescreen window. The monochrome views are
monochrome because those detectors carry no colour filter array.

The Hazcam fisheye is a real remap, not a lens effect: the scene is rendered
rectilinear at whatever field of view puts the fisheye's edge ray on the frame
boundary, then resampled so output radius is proportional to angle off-axis,
which is what *equidistant* means. A 124° fisheye needs a 124° rectilinear
render to feed it, so the source corners are stretched thin — the circular mask
that real Hazcam frames have anyway keeps that out of shot.

Mast instruments ride the mast head, so dragging slews them exactly as it slews
the real ones. Body instruments are bolted to the hull and don't slew at all,
which is rather the point of a hazard camera. Mount positions are placed from
published rover dimensions and the geometry of these meshes, not flight CAD.

MAHLI is absent: it lives on the arm turret, and the arm is fused into the
flight mesh, so there is nowhere dependable to hang it.

### Speed

Curiosity's actual top speed is **4.2 cm/s**. A faithful sim is unplayable — you
would cross a football pitch in forty minutes — so the default runs at ×120,
adjustable under ENVIRONMENT. The HUD always shows the true rover-equivalent speed
alongside the simulated one.

## Deep links

Any view can be shared as a URL:

```
/?hdg=138&cam=navcam        # Mount Sharp from the navigation camera
/?hdg=282&cam=navcam&t=17.9 # the blue sunset
/?ls=250&t=6.2              # a winter dawn
```

`hdg` heading in degrees, `t` local true solar time, `ls` season, `cam` one of
`orbit` / `chase` / `navcam` / `mastcam`, `model` one of `flight` /
`engineering`.

## Layout

```
lib/terrain.ts     height field — MOLA lookup + procedural detail, CPU and GLSL
lib/noise.ts       simplex noise, mirrored TypeScript/GLSL
lib/clipmap.ts     LOD ring geometry
lib/rover.ts       rocker-bogie solver, Ackermann steering
lib/sky.ts         atmospheric scattering
lib/mars.ts        constants and solar geometry
lib/landmarks.ts   landmarks found in the elevation data, not hard-coded
tools/             terrain pipeline and headless-browser checks
```

## Data credit

- **Terrain** — MOLA MEGDR, NASA PDS Geosciences Node. Smith, D. E. et al., Mars
  Global Surveyor MOLA Mission Experiment Gridded Data Records,
  `MGS-M-MOLA-5-MEGDR-L3-V1.0`.
- **Rover mesh** — NASA/JPL-Caltech, published at
  science.nasa.gov/resource/curiosity-rover-3d-model.
- **Traverse waypoints** — NASA/JPL MMGIS (`MSL_waypoints.json`): 1,371 localised
  positions from sol 3 to sol 4977, 37.99 km driven. Downloaded and analysed;
  not yet drawn in the scene.
