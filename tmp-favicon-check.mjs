import { chromium } from "@playwright/test";
import fs from "fs";

const raw = fs.readFileSync("src/assets/favicon.svg", "utf8");

const page = await (
  await chromium.launch({ channel: "chrome" })
).newPage({ viewport: { width: 300, height: 140 } });
await page.setContent(`<body style="margin:0;background:#fff;display:flex;gap:14px;align-items:center;padding:14px">
  <div style="font:12px sans-serif">${raw.replace('viewBox="0 0 32 32"', 'viewBox="0 0 32 32" width="96" height="96"')}</div>
  <div style="font:12px sans-serif">${raw.replace('viewBox="0 0 32 32"', 'viewBox="0 0 32 32" width="32" height="32"')}</div>
  <div style="font:12px sans-serif">${raw.replace('viewBox="0 0 32 32"', 'viewBox="0 0 32 32" width="16" height="16"')}</div>
</body>`);
await page.screenshot({ path: "tmp-favicon-check.png" });
console.log("ok");
process.exit(0);
