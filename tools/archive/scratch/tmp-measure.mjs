/*
 * Measures the supplied reference image so the logo's proportions come from the
 * art rather than from an estimate.
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

const result = await page.evaluate(async () => {
  const img = document.getElementById("i");
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { width: W, height: H } = c;
  const d = ctx.getImageData(0, 0, W, H).data;
  const dark = (x, y) => {
    const i = (y * W + x) * 4;
    return d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120;
  };
  // Bounding box of dark pixels.
  let minX = W,
    maxX = -1,
    minY = H,
    maxY = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (dark(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  // The vertical axis: the column with the most dark pixels.
  let bestCol = 0,
    bestCount = 0;
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = 0; y < H; y++) if (dark(x, y)) n++;
    if (n > bestCount) {
      bestCount = n;
      bestCol = x;
    }
  }
  // The horizontal axis: the row with the most dark pixels.
  let bestRow = 0,
    bestCountR = 0;
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (dark(x, y)) n++;
    if (n > bestCountR) {
      bestCountR = n;
      bestRow = y;
    }
  }
  // Horizontal extent on the horizontal axis row.
  let hMin = W,
    hMax = -1;
  for (let x = 0; x < W; x++)
    if (dark(x, bestRow)) {
      if (x < hMin) hMin = x;
      if (x > hMax) hMax = x;
    }
  // Vertical extent on the vertical axis column.
  let vMin = H,
    vMax = -1;
  for (let y = 0; y < H; y++)
    if (dark(bestCol, y)) {
      if (y < vMin) vMin = y;
      if (y > vMax) vMax = y;
    }
  return {
    W,
    H,
    bbox: { minX, maxX, minY, maxY },
    axisX: bestCol,
    axisY: bestRow,
    hMin,
    hMax,
    vMin,
    vMax,
  };
});

console.log(JSON.stringify(result, null, 1));

const { axisX: cx, axisY: cy, hMin, hMax, vMin, vMax } = result;
const R = Math.max(hMax - cx, cx - hMin, cy - vMin, vMax - cy);
console.log("\n--- ratios (R = half of circle's horizontal span) ---");
console.log("hLeft/R ", ((cx - hMin) / R).toFixed(3));
console.log("hRight/R", ((hMax - cx) / R).toFixed(3));
console.log("vUp/R   ", ((cy - vMin) / R).toFixed(3));
console.log("vDown/R ", ((vMax - cy) / R).toFixed(3));

await browser.close();
