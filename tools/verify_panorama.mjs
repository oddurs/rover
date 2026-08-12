/** Kick off a Navcam mosaic and confirm it stitches. */
import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader"],
  defaultViewport: { width: 1280, height: 760 },
});
const p = await b.newPage();
p.on("pageerror", e => console.log("[pageerror]", e.message));
await p.goto("http://localhost:3323/?cam=navcam&hdg=138&t=15.4", { waitUntil:"networkidle2", timeout:120000 });
await new Promise(r => setTimeout(r, 12000));
const started = await p.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "PANORAMA");
  if (!btn) return false; btn.click(); return true;
});
console.log("started:", started);
const t0 = Date.now();
let last = -1;
while (Date.now() - t0 < 240000) {
  const s = await p.evaluate(() => {
    const img = document.querySelector('img[alt$="panorama"]');
    const b = [...document.querySelectorAll("button")].find(x => x.textContent?.includes("SWEEPING"));
    return { sweeping: b?.textContent ?? null, w: img?.naturalWidth ?? 0, h: img?.naturalHeight ?? 0 };
  });
  if (s.sweeping && s.sweeping !== last) { console.log(" ", s.sweeping); last = s.sweeping; }
  if (s.w) { console.log(`stitched: ${s.w} x ${s.h} px`); break; }
  await new Promise(r => setTimeout(r, 1500));
}
await p.screenshot({ path: process.argv[2] ?? "pano.png" });
await b.close();
