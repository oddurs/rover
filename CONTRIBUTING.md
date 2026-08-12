# Contributing

Thanks for taking a look. This is a small project with an unusual constraint:
most of what it draws is derived from real data, and the parts that aren't are
clearly marked. Contributions that keep that line sharp are very welcome.

## Getting set up

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

The terrain and rover meshes are committed, so a clone runs immediately. You
only need the Python tooling if you want to regenerate them — see
[docs/DATA.md](docs/DATA.md).

## Before you open a PR

```bash
pnpm verify         # lint, typecheck, production build
```

## The one rule that matters

**If you claim something is real, it has to be real.**

The README says the crater rim is where MOLA measured it, that Curiosity's top
speed is 4.2 cm/s, and that the terrain palette came off a Mastcam frame. Those
claims are the point of the project. So:

- Derive constants where you can, rather than typing a plausible number. The
  turn-in-place rate isn't 1.5°/s because that looked right — it falls out of
  the rover's own top speed and its wheel geometry, and the code says so.
- If something is invented, say so in the comment. The sub-460 m terrain detail,
  the clast field and the rock colours are all invented, and all labelled.
- If you tune a value for feel rather than fidelity, that is completely fine —
  write down that you did.

## Verifying visual work

Rendering bugs are hard to catch by reading a diff, so the repo carries tools
that drive the app in a real browser and measure it:

| | |
|---|---|
| `tools/shoot.mjs out.png [secs] [keys]` | screenshot, with optional key presses |
| `tools/zoomshot.mjs out.png [ticks]` | zoomed-out orbit view, for LOD seams |
| `tools/contact.mjs` | wheel-to-ground clearance for all six wheels |
| `tools/verify_drive.mjs` | wheel spin direction and the differential |
| `tools/verify_arcade.mjs` | jump height, hang time, drift |
| `tools/verify_landing.mjs` | how a landing settles |
| `tools/verify_bumps.mjs` | how often crests throw the rover off the ground |
| `tools/verify_suspension.mjs` | suspension travel while driving |
| `tools/verify_panorama.mjs` | a full mosaic sweep, end to end |
| `tools/verify_lut.mjs` | proves the LUT lookup is neutral on identity |

They need a dev server running and Chrome installed; set `PORT` if you are not
on 3000. Several of these exist because a bug got through code review and only
a measurement caught it — the wheels spun backwards for a while, and the
landing spring was silently unstable at low frame rates. Adding one when you fix
something subtle is the most useful thing you can do here.

Note that headless WebGL runs on SwiftShader, several times slower than real
time. Anything timing-dependent needs a generous window.

## Style

- TypeScript, `pnpm lint` clean, no `eslint-disable` without a reason beside it.
- Comments explain *why*, especially where a number came from or where a
  physical shortcut was taken. There is a lot of that here and it is deliberate.
- No new dependencies without a good reason; the render path is hand-written on
  purpose.
