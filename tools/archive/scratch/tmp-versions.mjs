/*
 * Renders every logo geometry produced during this session, side by side, so the
 * right one can be identified rather than guessed at.
 */
import { chromium } from "@playwright/test";

const rad = (x) => (x * Math.PI) / 180;

/* V1 - the FIRST corrected version: semicircle-ish D, arc centred on the spine. */
const V1 = () => {
  const spineX = 6.2,
    half = 7.8,
    mid = 12,
    R = 7,
    gap = 56;
  const y1 = mid + R * Math.sin(rad(180 + gap / 2));
  const y2 = mid + R * Math.sin(rad(180 - gap / 2));
  return `
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M${spineX} ${mid - half}V${mid + half}"/>
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M${spineX} ${y2.toFixed(3)}A${R} ${R} 0 1 1 ${spineX} ${y1.toFixed(3)}"/>
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M${spineX - 4.6} ${mid}H${spineX + 5.4}"/>
<circle cx="${spineX}" cy="${mid}" r="2.5" fill="currentColor"/>`;
};

/* V2 - extended arc, centre offset right (BOWL_CX 12.6, R 8.8, 250 deg). */
const V2 = () => {
  const spineX = 6.2,
    half = 7.8,
    mid = 12,
    R = 8.8,
    gap = 110;
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

/* V3 - derived radius, spine 6.4, chord 7.6, overshoot 0.8, dot 2.15, stroke 1.15. */
const V3 = () => {
  const spineX = 6.4,
    half = 7.6,
    over = 0.8,
    mid = 12,
    gap = 110;
  const R = half / Math.sin(rad(gap / 2));
  const cx = spineX + R * Math.cos(rad(gap / 2));
  const a1 = 180 - gap / 2,
    a2 = 180 + gap / 2;
  const y1 = mid + R * Math.sin(rad(a1)),
    y2 = mid + R * Math.sin(rad(a2));
  return `
<path fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" d="M${spineX} ${mid - half - over}V${mid + half + over}"/>
<path fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" d="M${spineX} ${y2.toFixed(3)}A${R.toFixed(3)} ${R.toFixed(3)} 0 1 1 ${spineX} ${y1.toFixed(3)}"/>
<path fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" d="M${spineX - 4.6} ${mid}H${spineX + 3.4}"/>
<circle cx="${spineX}" cy="${mid}" r="2.15" fill="currentColor"/>`;
};

/* V4 - the committed file, which renders as a near-closed ring. */
const V4 = () => `
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M6.2 4.2V19.8"/>
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M6.2 8.714A7 7 0 1 1 6.2 15.286"/>
<path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M1.6 12H11.6"/>
<circle cx="6.2" cy="12" r="2.5" fill="currentColor"/>`;

const panel = (label, paths) => `
<div style="padding:10px;display:flex;flex-direction:column;align-items:center;gap:6px;background:#f2f8f7">
  <div style="font:12px monospace;color:#193335">${label}</div>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="180" height="180"><g color="#193335">${paths}</g></svg>
  <div style="display:flex;gap:6px;align-items:center">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><g color="#193335">${paths}</g></svg>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><g color="#193335">${paths}</g></svg>
  </div>
</div>`;

const body = `<body style="margin:0;background:#fff;display:flex;gap:8px;padding:10px">
${panel("V1 semicircle", V1())}
${panel("V2 offset 12.6/R8.8", V2())}
${panel("V3 derived/6.4", V3())}
${panel("V4 committed", V4())}
</body>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 880, height: 300 } });
await page.setContent(body);
await page.screenshot({ path: "tmp-versions.png" });
await browser.close();
console.log("ok");
