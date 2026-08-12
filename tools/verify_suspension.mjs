/**
 * Does the suspension actually work while driving, or only on landings?
 *
 * Samples the spring's travel while crossing rough ground at speed. A
 * suspension that only reacts to landings sits at zero the whole way.
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
await p.keyboard.down("w");
await new Promise(r => setTimeout(r, 4000));
let mn = 9, mx = -9, pmn = 9, pmx = -9, air = 0, n = 0, spd = 0;
const t0 = Date.now();
while (Date.now() - t0 < 32000) {
  const s = await p.evaluate(() => {
    const d = window.rover.drive;
    return { y: d.suspY, p: d.suspPitch, a: d.airborne, v: Math.hypot(d.vel.x, d.vel.z) };
  });
  mn = Math.min(mn, s.y); mx = Math.max(mx, s.y);
  pmn = Math.min(pmn, s.p); pmx = Math.max(pmx, s.p);
  if (s.a) air++;
  spd = Math.max(spd, s.v);
  n++;
  await new Promise(r => setTimeout(r, 50));
}
await p.keyboard.up("w");
console.log(`top speed      ${spd.toFixed(1)} m/s (cap 15)`);
console.log(`airborne       ${(100*air/n).toFixed(0)}% of samples`);
console.log(`spring travel  ${mn.toFixed(3)} .. ${mx.toFixed(3)} m`);
console.log(`hull rock      ${(pmn*57.3).toFixed(1)}° .. ${(pmx*57.3).toFixed(1)}°`);
await b.close();
