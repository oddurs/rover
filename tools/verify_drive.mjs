/** Drive forward briefly and check which way the wheels turned. */
import puppeteer from "puppeteer-core";

const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  defaultViewport: { width: 900, height: 600 },
});
const p = await b.newPage();
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
await p.goto(`http://localhost:${process.env.PORT ?? 3323}/${process.env.QS ?? ""}`, {
  waitUntil: "networkidle2",
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 9000));

const read = () =>
  p.evaluate(() => {
    const root = window.rover?.mounts?.root;
    if (!root) return null;
    const out = {};
    root.traverse((o) => {
      if (o.name && o.name.includes(".spin")) out[o.name] = +o.rotation.x.toFixed(4);
    });
    return { spin: out, odo: +window.rover.telemetry.odometer.toFixed(2) };
  });

const before = await read();
await p.keyboard.down("w");
await new Promise((r) => setTimeout(r, 2500));
await p.keyboard.up("w");
await new Promise((r) => setTimeout(r, 300));
const after = await read();

console.log("odometer", before.odo, "->", after.odo);
for (const k of Object.keys(after.spin).sort()) {
  const d = after.spin[k] - before.spin[k];
  console.log(`${k}  delta ${d.toFixed(3)} rad  ${d < 0 ? "OK (rolls forward)" : "WRONG WAY"}`);
}

// Let it come to a full stop first, or this measures a curving turn instead.
await new Promise((r) => setTimeout(r, 3500));

// Now a left turn in place: the two sides must roll opposite ways.
const t0 = await read();
await p.keyboard.down("a");
await new Promise((r) => setTimeout(r, 5000));
await p.keyboard.up("a");
await new Promise((r) => setTimeout(r, 300));
const t1 = await read();
const dL = t1.spin["L.spin1"] - t0.spin["L.spin1"];
const dR = t1.spin["R.spin1"] - t0.spin["R.spin1"];
console.log(`\nturn in place: L ${dL.toFixed(3)}  R ${dR.toFixed(3)}  ${dL * dR < 0 ? "OK (opposed)" : "WRONG (same direction)"}`);

// Corner actuators must sweep, not jump.
const sweep = await p.evaluate(() => {
  const root = window.rover?.mounts?.root;
  const g = root?.getObjectByName("L.steer0");
  return g ? +g.rotation.y.toFixed(3) : null;
});
console.log("front-left corner angle after turn:", sweep, "rad");
await b.close();
