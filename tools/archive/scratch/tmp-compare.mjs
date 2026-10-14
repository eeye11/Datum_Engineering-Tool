/*
 * Renders candidate geometries against the reference proportions, so the closest
 * match can be picked by eye AND by measurement.
 *
 * The reference, read off the supplied image (497 x 390, dot near the centre):
 *
 *   - a LONG vertical line, well past the arc at both ends
 *   - an arc open on the LEFT, its two ends STOPPING SHORT of the vertical line
 *   - a SHORT horizontal line, roughly symmetric about the dot
 *   - a LARGE solid dot at the crossing
 */
import { chromium } from "@playwright/test";

const rad = (x) => (x * Math.PI) / 180;

const build = ({
  spineX,
  vHalf,
  R,
  arcCx,
  arcCy,
  gapDeg,
  hLeft,
  hRight,
  dot,
  stroke,
  opening,
}) => {
  /* Arc ends, measured from the arc's own centre - NOT snapped to the axis. */
  const a1 = 180 + (opening ? gapDeg / 2 : -gapDeg / 2);
  const a2 = 180 - (opening ? gapDeg / 2 : -gapDeg / 2);
  const p1 = {
    x: (arcCx + R * Math.cos(rad(a1))).toFixed(3),
    y: (arcCy + R * Math.sin(rad(a1))).toFixed(3),
  };
  const p2 = {
    x: (arcCx + R * Math.cos(rad(a2))).toFixed(3),
    y: (arcCy + R * Math.sin(rad(a2))).toFixed(3),
  };
  return `
<path fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" d="M${spineX} ${(arcCy - vHalf).toFixed(3)}V${(arcCy + vHalf).toFixed(3)}"/>
<path fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" d="M${p1.x} ${p1.y}A${R} ${R} 0 1 1 ${p2.x} ${p2.y}"/>
<path fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" d="M${(spineX - hLeft).toFixed(3)} ${arcCy}H${(spineX + hRight).toFixed(3)}"/>
<circle cx="${spineX}" cy="${arcCy}" r="${dot}" fill="currentColor"/>`;
};

/*
 * CANDIDATE: the reference reading.
 *   - arc centred ON the vertical line (so the arc's ends are symmetric about it)
 *   - a wide opening, ends standing clear of the line
 *   - a long vertical line, a short symmetric horizontal bar, a big dot
 */
const CAND = build({
  spineX: 12,
  vHalf: 11,
  R: 7.4,
  arcCx: 12,
  arcCy: 12,
  gapDeg: 130,
  opening: true,
  hLeft: 4.2,
  hRight: 4.2,
  dot: 2.9,
  stroke: 1.6,
});

const panel = (label, paths) => `
<div style="padding:12px;background:#f2f8f7;display:flex;flex-direction:column;align-items:center;gap:8px">
  <div style="font:12px monospace;color:#193335">${label}</div>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="240" height="240"><g color="#193335">${paths}</g></svg>
  <div style="display:flex;gap:8px">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32"><g color="#193335">${paths}</g></svg>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16"><g color="#193335">${paths}</g></svg>
  </div>
</div>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 300, height: 340 } });
await page.setContent(
  `<body style="margin:0;background:#fff">${panel("arc centred on the line, wide opening", CAND)}</body>`,
);
await page.screenshot({ path: "tmp-compare.png" });
await browser.close();
console.log(CAND);
