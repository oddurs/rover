/** Check that arcade mode jumps and drifts the way it claims to. */
import puppeteer from "puppeteer-core";

const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
  defaultViewport: { width: 900, height: 600 },
});
const p = await b.newPage();
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
await p.goto(`http://localhost:3323/?mode=arcade&model=perseverance`, {
  waitUntil: "networkidle2", timeout: 120000,
});
await new Promise((r) => setTimeout(r, 10000));
const t = () => p.evaluate(() => ({ ...window.rover.telemetry }));

// Build speed, then jump.
await p.keyboard.down("w");
await new Promise((r) => setTimeout(r, 2500));
const cruise = await t();
console.log("cruise speed", cruise.speed.toFixed(2), "m/s");

await p.keyboard.down(" ");
await new Promise((r) => setTimeout(r, 120));
await p.keyboard.up(" ");

let peak = 0, airborneSeen = false;
const t0 = Date.now();
while (Date.now() - t0 < 6000) {
  const s = await t();
  if (s.airborne) airborneSeen = true;
  peak = Math.max(peak, s.airY);
  if (airborneSeen && !s.airborne && Date.now() - t0 > 800) {
    console.log(`jump: peak ${peak.toFixed(2)} m, hang ~${((Date.now()-t0)/1000).toFixed(2)} s`);
    break;
  }
  await new Promise((r) => setTimeout(r, 60));
}
if (!airborneSeen) console.log("JUMP FAILED - never left the ground");

// Now drift: hold throttle + steer + handbrake and watch lateral velocity.
await p.keyboard.down("a");
await p.keyboard.down("x");
await new Promise((r) => setTimeout(r, 1800));
const drift = await t();
await p.keyboard.up("x");
await p.keyboard.up("a");
await p.keyboard.up("w");
console.log(`drift: ${drift.drifting ? "engaged" : "NOT engaged"}, lateral ${Math.abs(drift.lateral).toFixed(2)} m/s`);
await b.close();
