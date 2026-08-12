/**
 * Sample the landing at high rate and report how it settles.
 *
 * A natural landing compresses once, overshoots slightly, and is done. Volatile
 * looks like several sign changes in the spring velocity, travel pinned at the
 * limit, or a large attitude step on the frame of touchdown.
 */
import puppeteer from "puppeteer-core";

const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  defaultViewport: { width: 640, height: 400 },
});
const p = await b.newPage();
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
await p.goto("http://localhost:3323/?mode=arcade", { waitUntil: "networkidle2", timeout: 120000 });
await new Promise((r) => setTimeout(r, 9000));

const st = () => p.evaluate(() => {
  const d = window.rover.drive;
  const r = window.rover.mounts.root;
  return {
    air: d.airborne, crash: d.crashed, y: d.airY, vy: d.vel.y,
    sy: d.suspY, svy: d.suspVY, sp: d.suspPitch, blend: d.landBlend,
    tilt: Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (r.quaternion.x ** 2 + r.quaternion.z ** 2)))),
  };
});

await p.keyboard.down("w");
await new Promise((r) => setTimeout(r, 2500));
await p.keyboard.press(" ");

let sawAir = false, landedAt = -1;
const trace = [];
const t0 = Date.now();
while (Date.now() - t0 < 150000) {
  const s = await st();
  if (s.air) sawAir = true;
  if (sawAir && !s.air && landedAt < 0) landedAt = trace.length;
  trace.push(s);
  if (landedAt >= 0 && trace.length - landedAt > 45) break;
  await new Promise((r) => setTimeout(r, 45));
}

const post = trace.slice(landedAt);
const travel = post.map((s) => s.sy);
const maxT = Math.max(...travel), minT = Math.min(...travel);
let signChanges = 0;
for (let i = 1; i < post.length; i++) {
  if (post[i].svy !== 0 && post[i - 1].svy !== 0 && Math.sign(post[i].svy) !== Math.sign(post[i - 1].svy)) signChanges++;
}
const tiltStep = Math.abs((post[1]?.tilt ?? 0) - (trace[landedAt - 1]?.tilt ?? 0));
const peakAir = Math.max(...trace.map((s) => s.y));
console.log(`peak height:    ${peakAir.toFixed(2)} m`);
console.log(`impact vy:      ${(trace[landedAt - 1]?.vy ?? 0).toFixed(2)} m/s`);
console.log(`spring vel@0:   ${post[0].svy.toFixed(2)} m/s`);
console.log(`crashed:        ${post[0].crash}`);
console.log(`travel:         ${minT.toFixed(3)} .. ${maxT.toFixed(3)} m  (limit 0.30)`);
console.log(`oscillations:   ${signChanges}  (1-2 = absorb and settle, many = pogo)`);
console.log(`attitude step:  ${(tiltStep * 57.3).toFixed(1)}° on the touchdown frame`);
console.log(`blend at touch: ${post[0].blend.toFixed(2)} -> ${post[post.length-1].blend.toFixed(2)}`);
await p.keyboard.up("w");
await b.close();
