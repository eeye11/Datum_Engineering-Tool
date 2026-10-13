import { chromium } from "@playwright/test";
import fs from "fs";

const fav = fs.readFileSync("src/assets/favicon.svg", "utf8");
const header = fs
  .readFileSync("index.html", "utf8")
  .match(/<span class="header-mark"[\s\S]*?<\/span>/)[0];
const at = (svg, s) =>
  svg.replace('width="24" height="24"', `width="${s}" height="${s}"`);

const body = `<body style="margin:0;background:#fff;font:12px sans-serif">
<div style="padding:14px;display:flex;gap:14px;align-items:center;background:#f2f8f7;color:#193335">
  <b>HEADER light</b>${at(header, 170)}${at(header, 48)}${at(header, 32)}${at(header, 24)}${at(header, 16)}
</div>
<div style="padding:14px;display:flex;gap:14px;align-items:center;background:#142426;color:#E8F5F3">
  <b>HEADER dark</b>${at(header, 170)}${at(header, 48)}${at(header, 32)}
</div>
<div style="padding:14px;display:flex;gap:14px;align-items:center">
  <b>FAVICON</b>${["170", "48", "32", "16"].map((s) => `<span style="background:#fff;padding:4px;display:inline-block">${fav.replace('viewBox="0 0 32 32"', `viewBox="0 0 32 32" width="${s}" height="${s}"`)}</span>`).join("")}
</div>
<div style="padding:14px;display:flex;gap:14px;align-items:center">
  <b>PNG</b><img src="src/assets/favicon.png" width="32"><img src="src/assets/favicon-180.png" width="80">
</div>
</body>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1050, height: 700 } });
await page.setContent(body);
await page.waitForTimeout(300);
await page.screenshot({ path: "tmp-check.png" });
await browser.close();
console.log("ok");
