import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { markPaths } from "../../src/app/daetum-mark.js";

const paths = markPaths();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 24 24">${paths}</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 480 } });
await page.setContent(`<body style="margin:0">${svg}</body>`);
const info = await page.evaluate(() => {
  const p = document.querySelectorAll("path");
  const arc = p[2];
  const bb = arc.getBBox();
  const len = arc.getTotalLength();
  const mid = arc.getPointAtLength(len / 2);
  const start = arc.getPointAtLength(0);
  const end = arc.getPointAtLength(len);
  const dot = document.querySelector("circle").getBBox();
  return JSON.stringify({
    arcBBox: { x: bb.x, y: bb.y, w: bb.width, h: bb.height },
    arcStart: { x: start.x, y: start.y },
    arcMid: { x: mid.x, y: mid.y },
    arcEnd: { x: end.x, y: end.y },
    dotBBox: { x: dot.x, y: dot.y, w: dot.width, h: dot.height },
  });
});
writeFileSync(new URL("./arcinfo.txt", import.meta.url), info);
await browser.close();
process.stdout.write(info + "\n");
