import { chromium } from "@playwright/test";

/*
 * Renders the two candidate logos side by side so the right one can be picked.
 *   A: semicircle D - arc centred ON the spine (radius 7), endpoints on the spine
 *   B: extended-arc D - arc centre offset right, longer sweep
 */
const rad = (x) => (x * Math.PI) / 180;

/* --- Candidate A: arc centred on the spine --- */
const A = {
  spineX: 6.2,
  half: 7.8,
  mid: 12,
  R: 7,
  gap: 56,
};
const aMark = () => {
  const { spineX, half, mid, R, gap } = A;
  const a1 = 180 + gap / 2,
    a2 = 180 - gap / 2;
  const y1 = mid + R * Math.sin(rad(a1)),
    y2 = mid + R * Math.sin(rad(a2));
  return `
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M${spineX} ${mid - half}V${mid + half}"/>
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M${spineX} ${y2.toFixed(3)}A${R} ${R} 0 1 1 ${spineX} ${y1.toFixed(3)}"/>
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M${spineX - 4.6} ${mid}H${spineX + 5.4}"/>
<circle cx="${spineX}" cy="${mid}" r="2.5" fill="currentColor"/>`;
};

/* --- Candidate B: extended arc, centre offset right --- */
const B = { spineX: 6.2, half: 7.8, mid: 12, R: 8.8, cx: 12.6, sweep: 250 };
const bMark = () => {
  const { spineX, half, mid, R, cx, sweep } = B;
  const gap = 360 - sweep;
  const a1 = 180 - gap / 2,
    a2 = 180 + gap / 2;
  const y1 = mid + R * Math.sin(rad(a1)),
    y2 = mid + R * Math.sin(rad(a2));
  return `
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M${spineX} ${mid - half}V${mid + half}"/>
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M${spineX} ${y2.toFixed(3)}A${R} ${R} 0 1 1 ${spineX} ${y1.toFixed(3)}"/>
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M${spineX - 4.4} ${mid}H${spineX + 6.6}"/>
<circle cx="${spineX}" cy="${mid}" r="3.1" fill="currentColor"/>`;
};

const panel = (label, paths, colour, bg) => `
<div style="background:${bg};padding:14px;display:flex;flex-direction:column;align-items:center;gap:8px">
  <div style="font:13px monospace;color:${colour}">${label}</div>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="180" height="180"><g color="${colour}">${paths}</g></svg>
  <div style="display:flex;gap:8px;align-items:center">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><g color="${colour}">${paths}</g></svg>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><g color="${colour}">${paths}</g></svg>
  </div>
</div>`;

const body = `<body style="margin:0;background:#fff;display:flex;gap:10px;padding:14px">
${panel("A - semicircle D (centre on spine)", aMark(), "#193335", "#f2f8f7")}
${panel("B - extended arc (centre offset right)", bMark(), "#193335", "#f2f8f7")}
</body>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 560, height: 300 } });
await page.setContent(body);
await page.screenshot({ path: "tmp-candidates.png" });
await browser.close();
console.log("ok");
