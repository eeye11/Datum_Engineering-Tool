import { makeHelpers, evalInPage } from "./qa-helpers.mjs";

export default async function run(page) {
  const out = { steps: [] };
  const log = (s, v) => out.steps.push({ step: s, value: v });
  const safe = async (n, f) => {
    try {
      log(n, await f());
    } catch (e) {
      log(n, { error: String(e).slice(0, 250) });
    }
  };

  const h = await makeHelpers(page);
  await h.category("STATICS");

  // A beam, a support on it, and a moment in free space.
  await h.tool("body");
  await h.sub("Beam");
  await h.click(0.15, 0.55);
  await h.click(0.85, 0.55);
  await page.waitForTimeout(400);

  await h.tool("support");
  await h.sub("Pin Support");
  await h.click(0.5, 0.55);
  await h.click(0.5, 0.62);
  await page.waitForTimeout(400);

  // Moment in BLANK space: this is the new behaviour.
  await h.tool("moment");
  await h.sub("Applied Moment");
  await safe("moment armed", h.msg);
  await h.click(0.3, 0.25);
  await page.waitForTimeout(500);

  await safe("moment created in free space", () =>
    h.allObjects().then((o) => o.map((x) => x.type)),
  );

  const moment = (await h.allObjects()).find((o) => o.type === "moment");
  await safe("moment defaults CCW", () => ({
    has: !!moment,
    position: moment?.position,
  }));

  // Select the beam so the selection styling is visible, and check
  // that nothing is filled blue.
  await h.tool("select");
  await h.click(0.3, 0.55);
  await page.waitForTimeout(500);
  await safe("selection fills", () =>
    h.evalInPage(
      page,
      `
      var g = document.querySelector("g.drawing-entity-selected");
      if (!g) {
        document.documentElement.setAttribute("data-qa", JSON.stringify({ none: true }));
      } else {
        var filled = [...g.querySelectorAll("polygon, path, rect, circle")]
          .map(function (n) {
            return { tag: n.tagName, fill: n.getAttribute("fill"),
                     fillOpacity: n.getAttribute("fill-opacity") };
          });
        document.documentElement.setAttribute("data-qa", JSON.stringify({
          type: g.getAttribute("data-feature-type"),
          filled: filled
        }));
      }`,
    ),
  );

  await page.screenshot({ path: "qa-selection.png" });

  return out;
}
