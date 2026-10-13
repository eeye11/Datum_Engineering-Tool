/*
 * VISUAL COMPARISON OF TWO BUILDS.
 *
 *   node tests/e2e/visual-compare.mjs <beforeUrl> <afterUrl> <outDir>
 *
 * Takes the same screenshots of both builds - the page at load, the
 * drawing workspace, a Statics toolset, a selected feature's panel - and
 * reports which differ, pixel for pixel. Differing pairs are saved to
 * outDir for inspection. The golden-master scenario checks behaviour;
 * this checks appearance, which it cannot see.
 */
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";

const [beforeUrl, afterUrl, outDir = "visual-diff"] = process.argv.slice(2);

const SCENES = {
    "1-written-solution": async () => {},
    "2-drawing-geometry": async page => {
        await page.click("text=Engineering Drawing");
    },
    "3-statics-toolset": async page => {
        await page.click("text=Engineering Drawing");
        await page.click('.drawing-category[data-category="STATICS"]');
    },
    "4-beam-selected": async page => {
        await page.click("text=Engineering Drawing");
        await page.click('.drawing-category[data-category="STATICS"]');
        await page.click('.drawing-tool[data-tool-id="body"]');
        // Bodies opens an INLINE section now, not a popup submenu.
        await page.click('#statics-body-tools .drawing-tool[data-tool-id="beam"]');
        const r = await page.evaluate(() => document.querySelector(".drawing-canvas").getBoundingClientRect().toJSON());
        for (const fx of [0.3, 0.7]) {
            const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * 0.55);
            await page.mouse.move(x, y);
            await page.mouse.click(x, y);
            await page.waitForTimeout(200);
        }
        if (await page.evaluate(() => !!document.querySelector(".drawing-creation-dimension"))) {
            await page.keyboard.type("100");
            await page.keyboard.press("Enter");
        }
        await page.keyboard.press("Escape");
        const row = page.locator(".drawing-component-row").first();
        if (await row.count()) await row.click();
        await page.mouse.move(5, 5);
    }
};

async function shoot(url, scene) {
    const browser = await chromium.launch({ channel: "chrome" });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    await context.addInitScript(() => {
        // Deterministic ids and no recovery prompt from an earlier session.
        let n = 0;
        Object.defineProperty(crypto, "randomUUID", {
            value: () => { const h = (++n).toString(16).padStart(12, "0"); return `${h.slice(4)}-${h.slice(0, 4)}-4000-8000-${h}`; },
            configurable: true
        });
        try { localStorage.clear(); } catch {}
    });
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForTimeout(400);
    await SCENES[scene](page);
    await page.waitForTimeout(400);
    // MathJax arrives from a CDN at its own pace; its output is not under test.
    await page.addStyleTag({ content: "mjx-container, #writingOutput { visibility: hidden !important; }" });
    const image = await page.screenshot();
    await browser.close();
    return image;
}

fs.mkdirSync(outDir, { recursive: true });
let differing = 0;
for (const scene of Object.keys(SCENES)) {
    const [before, after] = [await shoot(beforeUrl, scene), await shoot(afterUrl, scene)];
    const same = before.equals(after);
    console.log(`${same ? "  same" : "  DIFF"}  ${scene}`);
    if (!same) {
        differing++;
        fs.writeFileSync(path.join(outDir, `${scene}.before.png`), before);
        fs.writeFileSync(path.join(outDir, `${scene}.after.png`), after);
    }
}
console.log(`\n${Object.keys(SCENES).length - differing}/${Object.keys(SCENES).length} scenes identical`);
process.exit(differing ? 1 : 0);
