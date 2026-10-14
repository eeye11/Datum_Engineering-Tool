import { chromium } from "@playwright/test";

const rad = (x) => (x * Math.PI) / 180;
const R = 7,
  cx = 12,
  cy = 12;
const p = (a) => [cx + R * Math.cos(rad(a)), cy + R * Math.sin(rad(a))];
const upper = 242,
  lower = 118;
const [ux, uy] = p(upper),
  [lx, ly] = p(lower);

const variants = [
  ["upper->lower  lg1 sw1", ux, uy, lx, ly, 1, 1],
  ["upper->lower  lg1 sw0", ux, uy, lx, ly, 1, 0],
  ["lower->upper  lg1 sw1", lx, ly, ux, uy, 1, 1],
  ["lower->upper  lg1 sw0", lx, ly, ux, uy, 1, 0],
];

const svgFor = ([, x1, y1, x2, y2, lg, sw]) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="150" height="150">
<path fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round" d="M12 0.6V23.4"/>
<path fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round" d="M4 12H16"/>
<path fill="none" stroke="#c00" stroke-width="1.6" stroke-linecap="round"
  d="M${x1.toFixed(3)} ${y1.toFixed(3)}A${R} ${R} 0 ${lg} ${sw} ${x2.toFixed(3)} ${y2.toFixed(3)}"/>
<circle cx="12" cy="12" r="3" fill="#111"/>
</svg>`;

const body = `<body style="margin:0;background:#fff;display:flex;flex-wrap:wrap;gap:8px;padding:8px;font:10px sans-serif">
${variants.map((v) => `<div>${v[0]}${svgFor(v)}</div>`).join("")}</body>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 340, height: 340 } });
await page.setContent(body);
await page.screenshot({ path: "tmp-arc-flags.png" });
await browser.close();
console.log("ok");
