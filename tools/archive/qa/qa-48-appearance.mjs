/*
 * Section 15, part 5: appearance.
 *
 * Reads the ACTUAL stroke widths and arrowhead sizes off the
 * rendered SVG, and sets style through the real Features panel
 * controls - the same path a user takes - rather than poking the
 * model, so the check covers the panel binding and the renderer
 * together.
 */
export function evalInPage(page, source) {
  return page.evaluate(
    (body) => {
      const script = document.createElement("script");
      script.textContent = body;
      document.body.appendChild(script);
      const raw = document.documentElement.getAttribute("data-qa");
      document.documentElement.removeAttribute("data-qa");
      script.remove();
      return raw ? JSON.parse(raw) : null;
    },
    `try { ${source} } catch (error) {
      document.documentElement.setAttribute("data-qa",
        JSON.stringify({ qaError: String(error && error.message || error) }));
    }`,
  );
}

const READ = `
  var st = window.enggDrawing.state;
  var id = (st.selection && st.selection.selectedObjectIds || [])[0];
  var f = null;
  st.objects.forEach(function (o) { if (o.id === id) f = o; });

  var nodes = [...document.querySelectorAll("[data-feature-id]")];
  var g = null;
  for (var i = 0; i < nodes.length; i += 1) {
    if (nodes[i].getAttribute("data-feature-id") === id) g = nodes[i];
  }

  var lines = g ? [...g.querySelectorAll("line")] : [];
  var heads = g ? [...g.querySelectorAll("polygon")] : [];

  document.documentElement.setAttribute("data-qa", JSON.stringify({
    type: f ? f.type : null,
    storedLineWidth: f && f.style ? f.style.lineWidth : null,
    storedLineType: f && f.style ? f.style.lineType : null,
    widths: lines.map(function (l) { return +l.getAttribute("stroke-width"); }),
    dash: lines.map(function (l) { return l.getAttribute("stroke-dasharray"); }),
    heads: heads.map(function (p) {
      var pts = p.getAttribute("points").split(" ");
      var t = pts[0].split(",").map(Number);
      var a = pts[1].split(",").map(Number);
      return +Math.hypot(t[0] - a[0], t[1] - a[1]).toFixed(2);
    })
  }));
`;

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

  const tab = page.getByRole("button", { name: "Engineering Drawing" });
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(1500);
  }

  const box = await page.locator(".drawing-canvas").first().boundingBox();
  const at = (fx, fy) => ({
    x: box.x + box.width * fx,
    y: box.y + box.height * fy,
  });
  const click = async (fx, fy) => {
    const p = at(fx, fy);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(320);
  };
  const move = async (fx, fy) => {
    const p = at(fx, fy);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(180);
  };
  const tool = async (id) => {
    await page.locator(`.drawing-tool[data-tool-id="${id}"]`).click();
    await page.waitForTimeout(320);
  };
  const sub = async (label) => {
    await page
      .locator(".drawing-coordinate-submenu-item", { hasText: label })
      .first()
      .click();
    await page.waitForTimeout(340);
  };

  await page.locator('.drawing-category[data-category="STATICS"]').click();
  await page.waitForTimeout(320);

  // The panel keeps the tree until the selected feature is clicked
  // again; that second click is what opens the editing page.
  const openPanel = async () => {
    const sel = "#drawingProperties .drawing-component-row[data-object-id]";
    const row = page.locator(sel).first();
    await row.click();
    await page.waitForTimeout(450);
    await page.locator(sel).first().click();
    await page.waitForTimeout(800);
  };

  const read = () => evalInPage(page, READ);

  const setWidth = async (v) => {
    const field = page.locator('#drawingProperties [data-style="lineWidth"]');
    await field.click();
    await field.fill(String(v));
    await page.waitForTimeout(500);
  };
  const setType = async (v) => {
    await page
      .locator('#drawingProperties [data-style="lineType"]')
      .selectOption(v);
    await page.waitForTimeout(500);
  };

  // --- Point Force.
  await tool("point-force");
  await click(0.3, 0.3);
  await click(0.55, 0.18);
  await page.waitForTimeout(600);
  await safe("force default", read);

  await openPanel();
  await safe("force panel", () =>
    page.evaluate(() =>
      (document.querySelector("#drawingProperties") || {}).innerText
        ?.replace(/\n+/g, " | ")
        .slice(0, 200),
    ),
  );

  await setWidth(4);
  await safe("force width 4", read);
  await setWidth(0.5);
  await safe("force width 0.5", read);
  await setType("dashed");
  await safe("force dashed", read);
  await setType("center");
  await safe("force centre", read);

  // --- Distributed Load.
  await tool("load");
  await sub("Distributed Load");
  await click(0.15, 0.6);
  await click(0.85, 0.6);
  await move(0.45, 0.45);
  await click(0.45, 0.45);
  await page.waitForTimeout(600);
  await openPanel();
  await safe("load default", read);
  await setWidth(4);
  await safe("load width 4", read);
  await setWidth(0.5);
  await safe("load width 0.5", read);
  await setType("dashed");
  await safe("load dashed", read);

  return out;
}
