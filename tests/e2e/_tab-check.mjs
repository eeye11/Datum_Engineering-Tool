export default async function run(page, ui) {
  const errors = [];

  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.waitForTimeout(1500);

  const before = await ui.snapshot();

  const tab = before.match(/@(e\d+) (?:tab|button|link) "Engineering Drawing"/);

  if (!tab) {
    return { error: "no Engineering Drawing tab in snapshot", snapshot: before };
  }

  await ui.click(tab[1]);
  await page.waitForTimeout(1500);

  const after = await ui.snapshot();
  const full = await ui.snapshot({ full: true });

  const canvas = await page.evaluate(() => {
    const svg = document.querySelector(".canvas-area svg, #drawing-canvas, svg");

    return {
      svgPresent: Boolean(svg),
      svgChildren: svg ? svg.querySelectorAll("*").length : 0,
      activePage: document.body.dataset.page || null,
      visibleTabs: [...document.querySelectorAll("[aria-selected='true']")].map((node) => node.textContent.trim())
    };
  });

  return {
    errors,
    clicked: tab[1],
    canvas,
    hasToolbar: /Pipe|Geometry|Statics/i.test(after),
    fullHead: full.slice(0, 1800)
  };
}
