/*
 * Renders src/assets/favicon.svg into the PNG fallback a browser that cannot
 * read an SVG favicon will use. Both carry the same geometry and the same fixed
 * brand colour, so the tab looks identical whichever one is picked.
 *
 *   node tools/build-favicon-png.mjs
 */
import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const svgPath = path.join("src", "assets", "favicon.svg");
const pngPath = path.join("src", "assets", "favicon.png");

const svg = fs.readFileSync(svgPath, "utf8");

/* Two sizes in one pass: the 32 px icon, and a 180 px apple-touch icon. */
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 200, height: 200 } });

const render = async (size, file) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>` +
      svg.replace(
        'viewBox="0 0 32 32"',
        `viewBox="0 0 32 32" width="${size}" height="${size}"`,
      ),
  );
  await page.screenshot({ path: file, omitBackground: true });
};

await render(32, pngPath);
await render(180, path.join("src", "assets", "favicon-180.png"));

await browser.close();
console.log(`wrote ${pngPath} and src/assets/favicon-180.png`);
