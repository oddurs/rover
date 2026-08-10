/** Screenshot the orbit view zoomed well out, to inspect clipmap seams. */
import puppeteer from "puppeteer-core";
const out = process.argv[2] ?? "zoom.png";
const ticks = Number(process.argv[3] ?? 14);
const b = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"],
  defaultViewport: { width: 1440, height: 810 },
});
const p = await b.newPage();
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
await p.goto(`http://localhost:${process.env.PORT ?? 3323}/${process.env.QS ?? ""}`, {
  waitUntil: "networkidle2", timeout: 120000,
});
await new Promise((r) => setTimeout(r, 10000));
await p.mouse.move(720, 405);
for (let i = 0; i < ticks; i++) {
  await p.mouse.wheel({ deltaY: 220 });
  await new Promise((r) => setTimeout(r, 120));
}
// Drag upward to raise the camera toward a top-down angle.
await p.mouse.move(720, 300);
await p.mouse.down();
for (let i = 0; i < 12; i++) {
  await p.mouse.move(720, 300 + i * 16);
  await new Promise((r) => setTimeout(r, 80));
}
await p.mouse.up();
await new Promise((r) => setTimeout(r, 7000));
await p.screenshot({ path: out });
console.log("wrote", out);
await b.close();
