/*
 * Prints an ASCII map of a PNG so the geometry can be read off the pixels
 * rather than estimated by eye.
 *
 *   node tmp-ref-map.mjs <file.png>
 */
import { chromium } from "@playwright/test";
import fs from "fs";

const file = process.argv[2];
const dataUrl =
  "data:image/png;base64," + fs.readFileSync(file).toString("base64");

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.setContent(`<img id="i" src="${dataUrl}">`);
await page.waitForFunction(() => {
  const i = document.getElementById("i");
  return i && i.complete && i.naturalWidth;
});

const out = await page.evaluate(() => {
  const img = document.getElementById("i");
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { width: W, height: H } = c;
  const d = ctx.getImageData(0, 0, W, H).data;

  /* The reference is dark strokes on a pale pink/grey grid. Take the ink. */
  const ink = (x, y) => {
    const i = (y * W + x) * 4;
    return d[i] < 110 && d[i + 1] < 110 && d[i + 2] < 110;
  };

  /* Bounding box of the ink. */
  let minX = W,
    maxX = -1,
    minY = H,
    maxY = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (ink(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

  /* The column and row with the most ink = the two axes. */
  let axisX = 0,
    bestC = 0;
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = 0; y < H; y++) if (ink(x, y)) n++;
    if (n > bestC) {
      bestC = n;
      axisX = x;
    }
  }
  let axisY = 0,
    bestR = 0;
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (ink(x, y)) n++;
    if (n > bestR) {
      bestR = n;
      axisY = y;
    }
  }

  /* Extents along those two lines. */
  let vMin = H,
    vMax = -1;
  for (let y = 0; y < H; y++)
    if (ink(axisX, y)) {
      if (y < vMin) vMin = y;
      if (y > vMax) vMax = y;
    }
  let hMin = W,
    hMax = -1;
  for (let x = 0; x < W; x++)
    if (ink(x, axisY)) {
      if (x < hMin) hMin = x;
      if (x > hMax) hMax = x;
    }

  /* The arc's horizontal extent, measured OFF the axis row. */
  let arcMinX = W,
    arcMaxX = -1;
  for (let y = 0; y < H; y++) {
    if (Math.abs(y - axisY) < 12) continue; // skip the horizontal bar
    for (let x = 0; x < W; x++) {
      if (Math.abs(x - axisX) < 4) continue; // skip the vertical rule
      if (ink(x, y)) {
        if (x < arcMinX) arcMinX = x;
        if (x > arcMaxX) arcMaxX = x;
      }
    }
  }

  /* An ASCII map, coarsened, for a visual cross-check. */
  const COLS = 76,
    ROWS = 40;
  let map = "";
  for (let r = 0; r < ROWS; r++) {
    let line = "";
    for (let cI = 0; cI < COLS; cI++) {
      const x = Math.floor((cI / COLS) * W);
      const y = Math.floor((r / ROWS) * H);
      line += ink(x, y) ? "#" : ".";
    }
    map += line + "\n";
  }

  return {
    W,
    H,
    bbox: { minX, maxX, minY, maxY },
    axisX,
    axisY,
    vMin,
    vMax,
    hMin,
    hMax,
    arcMinX,
    arcMaxX,
    map,
  };
});

const {
  W,
  H,
  bbox,
  axisX,
  axisY,
  vMin,
  vMax,
  hMin,
  hMax,
  arcMinX,
  arcMaxX,
  map,
} = out;
console.log(map);
console.log(`image ${W}x${H}`);
console.log(
  `ink bbox x ${bbox.minX}..${bbox.maxX}  y ${bbox.minY}..${bbox.maxY}`,
);
console.log(
  `vertical axis col ${axisX}, runs y ${vMin}..${vMax}  (length ${vMax - vMin})`,
);
console.log(
  `horizontal axis row ${axisY}, runs x ${hMin}..${hMax}  (length ${hMax - hMin})`,
);
console.log(`arc x extent (off-axis) ${arcMinX}..${arcMaxX}`);
console.log(`\n-- relative to the crossing (${axisX}, ${axisY}) --`);
console.log(`dot is at the crossing`);
console.log(`vertical: up ${axisY - vMin}  down ${vMax - axisY}`);
console.log(`horizontal: left ${axisX - hMin}  right ${hMax - axisX}`);
console.log(
  `arc: leftmost ${arcMinX - axisX} (negative = left of axis), rightmost ${arcMaxX - axisX}`,
);

await browser.close();
