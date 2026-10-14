// Confirm the other surfaces that read --datum-menu still render sensibly, and
// that genuinely unrelated panels are untouched.
export default async function run(page) {
  const wait = (ms) => page.waitForTimeout(ms);

  await page.waitForSelector(".datum-menubar", {
    timeout: 15000,
    state: "attached",
  });
  await page.evaluate(() => {
    const genTab = [...document.querySelectorAll("button, [role=tab]")].find(
      (b) => /engineering drawing/i.test(b.textContent || ""),
    );
    genTab?.click();
  });
  await wait(400);
  await page.evaluate(() => {
    document.body.classList.remove("datum-topbar-hidden");
    document.documentElement.setAttribute("data-theme", "light");
  });
  await wait(300);

  // Command search results: type into the search box to reveal the dropdown.
  const search = await page.evaluate(async () => {
    const input = document.querySelector(".drawing-command-search input");
    if (!input) return { found: false };
    input.focus();
    input.value = "line";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return { found: true };
  });
  await wait(300);
  const searchResults = await page.evaluate(() => {
    const r = document.querySelector(".datum-search-results");
    if (!r) return { present: false };
    const cs = getComputedStyle(r);
    return {
      present: true,
      bg: cs.backgroundColor,
      border: cs.borderColor,
      opacity: cs.opacity,
    };
  });

  // A genuinely unrelated panel: the right-hand feature/properties panel.
  const featurePanel = await page.evaluate(() => {
    const el =
      document.querySelector(".datum-feature-panel") ||
      document.querySelector(".drawing-features-panel") ||
      document.querySelector("#drawingFeatures");
    if (!el) return { found: false };
    return { found: true, bg: getComputedStyle(el).backgroundColor };
  });

  // Status bar / sheet bar (panel surfaces) must be unchanged.
  const panels = await page.evaluate(() => {
    const g = (sel) => {
      const e = document.querySelector(sel);
      return e ? getComputedStyle(e).backgroundColor : null;
    };
    return {
      statusBar: g(".drawing-status-bar"),
      sheetBar: g(".drawing-sheet-bar-row"),
      toolbar: g(".drawing-toolbar"),
      workspace: g(".drawing-workspace"),
    };
  });

  return { search, searchResults, featurePanel, panels };
}
