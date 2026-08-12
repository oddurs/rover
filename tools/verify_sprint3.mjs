/** Filter wheel, click-to-target, and frame capture. */
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader"],
  defaultViewport: { width: 1280, height: 760 },
});
const p = await b.newPage();
p.on("pageerror", e => console.log("[pageerror]", e.message));
await p.goto("http://localhost:3323/?cam=mastcam34&hdg=138&t=15.4", { waitUntil:"networkidle2", timeout:120000 });
await new Promise(r => setTimeout(r, 12000));

const click = (label) => p.evaluate((l) => {
  const btn = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === l);
  if (!btn) return false; btn.click(); return true;
}, label);

// Filter wheel
for (const f of ["445", "1012", "SOLAR"]) {
  const ok = await click(f);
  await new Promise(r => setTimeout(r, 2500));
  const px = await p.evaluate(() => {
    const c = document.querySelector("canvas");
    const g = c.getContext("webgl2");
    const buf = new Uint8Array(4);
    g.readPixels(Math.floor(c.width/2), Math.floor(c.height*0.62), 1, 1, g.RGBA, g.UNSIGNED_BYTE, buf);
    return [...buf].slice(0,3);
  });
  console.log(`filter ${f}: clicked=${ok} centre pixel rgb=${px}`);
}
await click("L0");
await new Promise(r => setTimeout(r, 2000));

// Click-to-target: click low in the frame and watch the mast slew.
await p.mouse.click(640, 560);
await new Promise(r => setTimeout(r, 3500));
const slew = await p.evaluate(() => {
  const h = window.rover.mounts.mastHead;
  return { tilt: +h.rotation.x.toFixed(3), pan: +h.rotation.y.toFixed(3) };
});
console.log("after click, mast pointing:", slew);

// Capture
const ok = await click("CAPTURE FRAME");
await new Promise(r => setTimeout(r, 3000));
const img = await p.evaluate(() => {
  const i = document.querySelector('img[alt="captured frame"]');
  return i ? { w: i.naturalWidth, h: i.naturalHeight } : null;
});
console.log("capture:", ok, img);
await p.screenshot({ path: process.argv[2] ?? "s3.png" });
await b.close();
