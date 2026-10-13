import { chromium } from "@playwright/test";
import fs from "fs";

const fav = fs.readFileSync("src/assets/favicon.svg", "utf8");
const headerSvg = (() => {
  const html = fs.readFileSync("index.html", "utf8");
  const m = html.match(/<span class="header-mark"[\s\S]*?<\/span>/);
  return m[0];
})();

const sized = (svg, size) =>
  svg.replace(
    /viewBox="0 0 24 24" width="24" height="24"/,
    `viewBox="0 0 24 24" width="${size}" height="${size}"`,
  );

const body = `<body style="margin:0;background:#fff;font:11px sans-serif">
<div style="padding:12px;display:flex;gap:10px;align-items:center;background:#f2f8f7">
  <b>HEADER light (from index.html)</b>
  <span style="color:#193335">${sized(headerSvg, 180)}</span>
  <span style="color:#193335">${sized(headerSvg, 48)}</span>
  <span style="color:#193335">${sized(headerSvg, 24)}</span>
</div>
<div style="padding:12px;display:flex;gap:10px;align-items:center;background:#142426;color:#E8F5F3">
  <b>HEADER dark</b>
  <span style="color:#E8F5F3">${sized(headerSvg, 180)}</span>
  <span style="color:#E8F5F3">${sized(headerSvg, 48)}</span>
</div>
<div style="padding:12px;display:flex;gap:10px;align-items:center">
  <b>FAVICON (fixed)</b>
  ${["180", "48", "32", "16"].map((s) => `<div style="background:#fff;padding:6px;display:inline-block">${fav.replace('viewBox="0 0 32 32"', `viewBox="0 0 32 32" width="${s}" height="${s}"`)}</div>`).join("")}
</div>
<div style="padding:12px;display:flex;gap:10px;align-items:center">
  <b>PNG fallback</b>
  <img src="src/assets/favicon.png" width="32"><img src="src/assets/favicon-180.png" width="90">
</div>
</body>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 980, height: 620 } });
await page.setContent(body);
await page.waitForTimeout(400);
await page.screenshot({ path: "tmp-check-all.png" });
await browser.close();
console.log("ok");
