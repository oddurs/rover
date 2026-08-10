/**
 * Measure wheel-to-ground contact.
 *
 * Walks the live scene graph for the six wheel meshes, takes each one's world
 * position, and compares it against the terrain height directly beneath. A
 * correctly seated rover has every wheel centre exactly one wheel radius above
 * the ground.
 */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  defaultViewport: { width: 900, height: 600 },
});

const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:${process.env.PORT ?? 3323}/${process.env.QS ?? ""}`, {
  waitUntil: "networkidle2",
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 6000));

const result = await page.evaluate(() => {
  const api = window.rover;
  if (!api?.mounts?.root) return { error: "rover not mounted" };

  const root = api.mounts.root;
  root.updateWorldMatrix(true, true);

  // Wheel meshes are the leaves whose geometry has the most vertices in the
  // suspension subtree; simpler to tag them by name.
  const wheels = [];
  root.traverse((o) => {
    if (o.userData?.wheel) wheels.push(o);
  });

  const out = wheels.map((w) => {
    // Read the translation straight out of the world matrix; constructing a
    // Vector3 from the page's three instance is fragile across builds.
    const e = w.matrixWorld.elements;
    const x = e[12];
    const y = e[13];
    const z = e[14];
    const ground = api.sampleHeight(x, z);
    return {
      name: w.userData.wheel,
      y: +y.toFixed(4),
      ground: +ground.toFixed(4),
      clearance: +(y - ground).toFixed(4),
    };
  });

  return {
    pitch: +((api.telemetry.pitch * 180) / Math.PI).toFixed(2),
    roll: +((api.telemetry.roll * 180) / Math.PI).toFixed(2),
    rootY: +root.position.y.toFixed(4),
    wheels: out,
  };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
