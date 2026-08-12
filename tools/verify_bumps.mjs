/**
 * Drive at speed and measure how often the terrain throws the rover off it.
 *
 * The condition is physical: wheels can only push up, so contact is lost when
 * convexity * v^2 exceeds gravity. This just reports what that works out to on
 * this terrain at this speed.
 */
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader"],
  defaultViewport: { width: 640, height: 400 },
});
const p = await b.newPage();
p.on("pageerror", e => console.log("[pageerror]", e.message));
await p.goto("http://localhost:3323/?mode=arcade&hdg=138", { waitUntil:"networkidle2", timeout:120000 });
await new Promise(r => setTimeout(r, 10000));

const run = async (boost, label) => {
  await p.keyboard.down("w");
  if (boost) await p.keyboard.down("Shift");
  await new Promise(r => setTimeout(r, 4000));
  let samples = 0, air = 0, hops = 0, wasAir = false, peak = 0, speed = 0, maxPeak = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const s = await p.evaluate(() => {
      const d = window.rover.drive;
      return { a: d.airborne, y: d.airY, v: Math.hypot(d.vel.x, d.vel.z) };
    });
    samples++; speed = Math.max(speed, s.v);
    if (s.a) { air++; peak = Math.max(peak, s.y); }
    if (s.a && !wasAir) hops++;
    if (!s.a && wasAir) { maxPeak = Math.max(maxPeak, peak); peak = 0; }
    wasAir = s.a;
    await new Promise(r => setTimeout(r, 55));
  }
  if (boost) await p.keyboard.up("Shift");
  await p.keyboard.up("w");
  await new Promise(r => setTimeout(r, 2500));
  const gCrit = 3.721 / (speed * speed);
  console.log(`${label}: ${speed.toFixed(1)} m/s | airborne ${(100*air/samples).toFixed(0)}% of samples | ${hops} launches | tallest ${maxPeak.toFixed(2)} m`);
  console.log(`   any crest tighter than ${(1/gCrit).toFixed(0)} m radius lifts it at this speed`);
};

await run(false, "cruise");
await run(true, "boost ");
await b.close();
