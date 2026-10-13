import { markPaths } from "./src/app/daetum-mark.js";
import { chromium } from "@playwright/test";
import fs from "fs";

const fav = fs.readFileSync("src/assets/favicon.svg", "utf8");

const header = (
  size,
  colour,
  bg,
) => `<div style="background:${bg};padding:8px;display:inline-block">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><g color="${colour}">${markPaths()}</g></svg></div>`;

const favicon = (
  size,
  bg,
) => `<div style="background:${bg};padding:8px;display:inline-block">
${fav.replace('viewBox="0 0 32 32"', `viewBox="0 0 32 32" width="${size}" height="${size}"`)}</div>`;

const body = `
<body style="margin:0;background:#fff;font:11px sans-serif">
<div style="padding:12px;display:flex;gap:12px;align-items:center">
  <b>HEADER (theme-aware)</b>
  ${header(160, "#193335", "#f2f8f7")}
  ${header(48, "#193335", "#f2f8f7")}
  ${header(24, "#193335", "#f2f8f7")}
  ${header(16, "#193335", "#f2f8f7")}
</div>
<div style="padding:12px;display:flex;gap:12px;align-items:center;background:#142426;color:#E8F5F3">
  <b>HEADER dark</b>
  ${header(160, "#E8F5F3", "#142426")}
  ${header(48, "#E8F5F3", "#142426")}
  ${header(24, "#E8F5F3", "#142426")}
  ${header(16, "#E8F5F3", "#142426")}
</div>
<div style="padding:12px;display:flex;gap:12px;align-items:center">
  <b>FAVICON (fixed #087E83)</b>
  ${favicon(160, "#ffffff")}
  ${favicon(48, "#ffffff")}
  ${favicon(32, "#ffffff")}
  ${favicon(16, "#ffffff")}
</div>
</body>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 760, height: 560 } });
await page.setContent(body);
await page.screenshot({ path: "tmp-verify-logos.png" });
await browser.close();
console.log("ok");
