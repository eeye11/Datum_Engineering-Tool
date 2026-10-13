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
<div style="padding:10px;display:flex;gap:10px;align-items:center;background:#f2f8f7">
  <b>HEADER light</b>${header(180, "#193335", "#f2f8f7")}${header(48, "#193335", "#f2f8f7")}${header(24, "#193335", "#f2f8f7")}${header(16, "#193335", "#f2f8f7")}
</div>
<div style="padding:10px;display:flex;gap:10px;align-items:center;background:#142426;color:#E8F5F3">
  <b>HEADER dark</b>${header(180, "#E8F5F3", "#142426")}${header(48, "#E8F5F3", "#142426")}${header(24, "#E8F5F3", "#142426")}${header(16, "#E8F5F3", "#142426")}
</div>
<div style="padding:10px;display:flex;gap:10px;align-items:center">
  <b>FAVICON fixed</b>${favicon(180, "#fff")}${favicon(48, "#fff")}${favicon(32, "#fff")}${favicon(16, "#fff")}
</div>
</body>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
await page.setContent(body);
await page.screenshot({ path: "tmp-final-logos.png" });
await browser.close();
console.log("ok");
