import { chromium } from "@playwright/test";

/* The module's real numbers. */
const rad = (x) => (x * Math.PI) / 180;
const SPINE_X = 12,
  midY = 12,
  chord = 7.8,
  halfGap = 60;
const R = chord / Math.sin(rad(halfGap));
const CX = SPINE_X + R * Math.cos(rad(halfGap));
const upperY = midY - chord;
const lowerY = midY + chord;

console.log("R", R.toFixed(3), "CX", CX.toFixed(3));

const svg = (lg, sw, label) => `
<div style="text-align:center;font:10px monospace">
${label}
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="170" height="170">
  <path fill="none" stroke="#111" stroke-width="1.15" stroke-linecap="round" d="M12 3.3V20.7"/>
  <path fill="none" stroke="#111" stroke-width="1.15" stroke-linecap="round" d="M5.4 12H15.4"/>
  <path fill="none" stroke="#c00" stroke-width="1.15" stroke-linecap="round"
    d="M12 ${upperY} A${R.toFixed(3)} ${R.toFixed(3)} 0 ${lg} ${sw} 12 ${lowerY}"/>
  <circle cx="12" cy="12" r="2.15" fill="#111"/>
</svg></div>`;

const body = `<body style="margin:0;background:#fff;display:flex;gap:6px;padding:8px">
${svg(1, 1, "lg1 sw1")}${svg(1, 0, "lg1 sw0")}${svg(0, 1, "lg0 sw1")}${svg(0, 0, "lg0 sw0")}</body>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 740, height: 210 } });
await page.setContent(body);
await page.screenshot({ path: "tmp-flags2.png" });
await browser.close();
console.log("ok");
