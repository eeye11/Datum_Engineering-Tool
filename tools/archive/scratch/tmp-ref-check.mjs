import { markPaths } from "./src/app/daetum-mark-new.js";
import { chromium } from "@playwright/test";

const mark = (
  size,
  colour,
  bg,
) => `<div style="background:${bg};padding:6px;display:inline-block">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><g color="${colour}">${markPaths()}</g></svg></div>`;

const body = `
<body style="margin:0;background:#fff;font:11px sans-serif">
<div style="display:flex;gap:10px;align-items:center;padding:10px;background:#f5e9e9">
${mark(240, "#111111", "#f5e9e9")}
${mark(48, "#111111", "#f5e9e9")}
${mark(24, "#111111", "#f5e9e9")}
${mark(16, "#111111", "#f5e9e9")}
</div>
<div style="display:flex;gap:10px;align-items:center;padding:10px;background:#142426">
${mark(240, "#E8F5F3", "#142426")}
</div>
</body>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 700, height: 560 } });
await page.setContent(body);
await page.screenshot({ path: "tmp-ref-check.png" });
await browser.close();
console.log("ok");
