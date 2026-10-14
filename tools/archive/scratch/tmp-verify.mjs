import { chromium } from "@playwright/test";
import fs from "fs";

const fav = fs.readFileSync("src/assets/favicon.svg", "utf8");
const headerBlock = fs
  .readFileSync("index.html", "utf8")
  .match(/<span class="header-mark"[\s\S]*?<\/span>/)[0];

/* Swap the fixed 24px size for the size we want to show. */
const at = (svg, size) =>
  svg.replace('width="24" height="24"', `width="${size}" height="${size}"`);

const body = `<body style="margin:0;background:#fff;font:11px sans-serif">
<div style="padding:12px;display:flex;gap:12px;align-items:center;background:#f2f8f7;color:#193335">
  <b>HEADER light (index.html)</b>
  ${at(headerBlock, 200)}${at(headerBlock, 48)}${at(headerBlock, 24)}${at(headerBlock, 16)}
</div>
<div style="padding:12px;display:flex;gap:12px;align-items:center;background:#142426;color:#E8F5F3">
  <b>HEADER dark</b>
  ${at(headerBlock, 200)}${at(headerBlock, 48)}
</div>
<div style="padding:12px;display:flex;gap:12px;align-items:center">
  <b>FAVICON fixed</b>
  ${["200", "48", "32", "16"].map((s) => `<span style="background:#fff;padding:4px;display:inline-block">${fav.replace('viewBox="0 0 32 32"', `viewBox="0 0 32 32" width="${s}" height="${s}"`)}</span>`).join("")}
</div>
<div style="padding:12px;display:flex;gap:12px;align-items:center">
  <b>PNG fallback</b>
  <img src="src/assets/favicon.png" width="32"><img src="src/assets/favicon-180.png" width="90">
</div>
</body>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1120, height: 680 } });
await page.setContent(body);
await page.waitForTimeout(400);
await page.screenshot({ path: "tmp-verify.png" });
await browser.close();
console.log("ok");
