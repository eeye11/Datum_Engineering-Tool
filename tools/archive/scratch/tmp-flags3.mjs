import { chromium } from "@playwright/test";

const rad = (x) => (x * Math.PI) / 180;
const R = 7.4,
  cx = 12,
  cy = 12,
  spineX = 12,
  vHalf = 11;
const t = 62;
const a1 = 180 + t,
  a2 = 180 - t;
const p1 = [cx + R * Math.cos(rad(a1)), cy + R * Math.sin(rad(a1))];
const p2 = [cx + R * Math.cos(rad(a2)), cy + R * Math.sin(rad(a2))];

const svg = (from, to, lg, sw, label) => `
<div style="text-align:center;font:10px monospace">
${label}
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="170" height="170">
<path fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round" d="M12 ${cy - vHalf}V${cy + vHalf}"/>
<path fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round" d="M7.8 12H16.2"/>
<path fill="none" stroke="#c00" stroke-width="1.6" stroke-linecap="round"
 d="M${from[0].toFixed(3)} ${from[1].toFixed(3)}A${R} ${R} 0 ${lg} ${sw} ${to[0].toFixed(3)} ${to[1].toFixed(3)}"/>
<circle cx="12" cy="12" r="2.9" fill="#111"/>
</svg></div>`;

const body = `<body style="margin:0;background:#fff;display:flex;gap:6px;padding:8px">
${svg(p1, p2, 1, 1, "upper->lower lg1 sw1")}
${svg(p1, p2, 1, 0, "upper->lower lg1 sw0")}
${svg(p2, p1, 1, 1, "lower->upper lg1 sw1")}
${svg(p2, p1, 1, 0, "lower->upper lg1 sw0")}
</body>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 740, height: 210 } });
await page.setContent(body);
await page.screenshot({ path: "tmp-flags3.png" });
await browser.close();
console.log("p1", p1, "p2", p2);
