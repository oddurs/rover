/**
 * Drive the app in a real browser, capture console output and a screenshot.
 *
 *   node tools/shoot.mjs <out.png> [seconds] [keys] [--probe]
 *
 * Uses the installed Chrome rather than downloading one. WebGL runs on
 * SwiftShader here, so it is slow but faithful enough to catch shader bugs.
 */
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , out = "shot.png", secsArg = "8", keysArg = "", ...rest] = process.argv;
const secs = Number(secsArg);
const probe = rest.includes("--probe");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
    "--hide-scrollbars",
    "--window-size=1440,810",
  ],
  defaultViewport: { width: 1440, height: 810 },
});

const page = await browser.newPage();
page.on("console", (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) =>
  console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`)
);

const BASE = process.env.URL ?? `http://localhost:${process.env.PORT ?? 3323}/`;
await page.goto(BASE + (process.env.QS ?? ""), { waitUntil: "networkidle2", timeout: 120000 });

if (probe) {
  const info = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const gl = c?.getContext("webgl2") ?? c?.getContext("webgl");
    if (!gl) return { error: "no gl context" };
    return {
      version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER),
      floatLinear: !!gl.getExtension("OES_texture_float_linear"),
      colorFloat: !!gl.getExtension("EXT_color_buffer_float"),
    };
  });
  console.log("[probe]", JSON.stringify(info));
}

for (const key of keysArg ? keysArg.split(",") : []) {
  const [name, holdMs = "600"] = key.split(":");
  await page.keyboard.down(name);
  await new Promise((r) => setTimeout(r, Number(holdMs)));
  await page.keyboard.up(name);
}

await new Promise((r) => setTimeout(r, secs * 1000));
await page.screenshot({ path: out });
console.log(`wrote ${out}`);
await browser.close();
