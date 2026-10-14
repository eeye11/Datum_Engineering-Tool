/*
 * QA: the Fluids Pipe / Duct route - draw one, open its Features page, read
 * the fields, then select a child segment and read ITS fields.
 *
 * The Features panel has two views: the component TREE and the selected
 * feature's EDITING page. Selecting a row once shows the tree; clicking the
 * SAME row again opens its editing page.
 */
import { makeHelpers, evalInPage } from "./qa-helpers.mjs";

const panelText = (page) =>
  evalInPage(
    page,
    [
      "var p = document.querySelector('#drawingProperties');",
      "document.documentElement.setAttribute('data-qa', JSON.stringify(",
      "  { props: [...p.querySelectorAll('[data-property]')].map(function(n){return n.dataset.property;}),",
      "    text: (p.innerText||'').replace(/\\n+/g,' | ') }));",
    ].join("\n"),
  );

const clickTreeRow = async (page, name) => {
  await page
    .locator(".drawing-component-row", { hasText: name })
    .first()
    .click();
  await page.waitForTimeout(300);
};

export default async function run(page) {
  const ui = await makeHelpers(page);

  await ui.category("FLUIDS");
  await ui.tool("pipe-duct");

  await ui.click(0.3, 0.4);
  await ui.click(0.6, 0.4);
  await ui.click(0.6, 0.7);
  await page.mouse.dblclick(ui.at(0.6, 0.7).x, ui.at(0.6, 0.7).y);
  await page.waitForTimeout(600);

  const objects = await ui.allObjects();
  const route = (objects || []).find((o) => o.type === "pipe-route");

  /* The route is selected on finish. Click its row twice: select, then edit. */
  await clickTreeRow(page, "Pipe Route");
  await clickTreeRow(page, "Pipe Route");

  const routePanel = await panelText(page);

  /*
   * BACK TO THE TREE, then open the first segment's editing page.
   *
   * The panel is on the route's editing page now, so the tree rows are not
   * on screen - the Features tab button returns to the tree, which is how a
   * student gets back to the list without deselecting.
   */
  await page.getByRole("button", { name: "Features" }).first().click();
  await page.waitForTimeout(300);

  await clickTreeRow(page, "Pipe Segment");
  await clickTreeRow(page, "Pipe Segment");

  const segmentPanel = await panelText(page);

  /*
   * OVERRIDE the segment's diameter, then read the model back.
   *
   * The inherit/override control names the property it acts on, so the panel
   * writes an explicit override and the route keeps its own value.
   */
  await page.locator('[data-route-override="diameter"]').first().click();
  await page.waitForTimeout(300);

  const afterOverride = await evalInPage(
    page,
    [
      "var st = window.enggDrawing.state;",
      "var id = (st.selection.selectedObjectIds||[])[0];",
      "var f = st.objects.find(function(o){return o.id===id;});",
      "var p = st.objects.find(function(o){return o.id===f.parentId;});",
      "document.documentElement.setAttribute('data-qa', JSON.stringify(",
      "  { overrides: f.engineering.overrides, childDiameter: f.engineering.diameter,",
      "    routeDiameter: p.engineering.diameter }));",
    ].join("\n"),
  );

  /* Back to the tree, then read the elbow editing page. */
  await page.getByRole("button", { name: "Features" }).first().click();
  await page.waitForTimeout(300);
  await clickTreeRow(page, "Elbow");
  await clickTreeRow(page, "Elbow");

  const elbowPanel = await panelText(page);

  return {
    routeId: route && route.id,
    routePanelKeys: routePanel.props,
    routePanelText: routePanel.text,
    segmentPanelKeys: segmentPanel.props,
    segmentPanelText: segmentPanel.text,
    afterOverride,
    elbowPanelText: elbowPanel.text,
  };
}