// Test the slate-200 panel + slate-300 hover pair in context, with a hover shown.
export default async function run(page, ui) {
  const wait = (ms) => page.waitForTimeout(ms);
  await page.waitForSelector(".datum-menubar", {
    timeout: 15000,
    state: "attached",
  });
  await page.evaluate(() => {
    const genTab = [
      ...document.querySelectorAll("button[role=tab], button, [role=tab]"),
    ].find((b) => /engineering drawing/i.test(b.textContent || ""));
    genTab?.click();
  });
  await wait(400);
  await page.evaluate(() => {
    document.body.classList.remove("datum-topbar-hidden");
    document.documentElement.setAttribute("data-theme", "light");
    const r = document.documentElement;
    r.style.setProperty("--datum-menu", "#D5E5E3");
    r.style.setProperty("--datum-menu-hover", "#C2D8D6");
    r.style.setProperty("--datum-menu-border", "#8FA9A7");
  });
  await wait(300);
  await page.evaluate(() => {
    document.querySelector('.datum-menu-label[data-menu-id="tools"]')?.click();
  });
  await wait(300);

  // Force a hover visual on the "Measure Angle" row so the hover state is visible.
  await page.evaluate(() => {
    const items = [
      ...document.querySelectorAll(".datum-menu-panel-tools .datum-menu-item"),
    ];
    const target = items.find((i) =>
      /measure angle/i.test(i.textContent || ""),
    );
    target?.classList.add("datum-menu-item-hover-demo");
    if (!document.getElementById("hover-demo-style")) {
      const s = document.createElement("style");
      s.id = "hover-demo-style";
      s.textContent =
        ".datum-menu-item-hover-demo{background:#C2D8D6 !important}";
      document.head.appendChild(s);
    }
  });
  await wait(200);

  return await page.evaluate(() => {
    const p = document.querySelector(".datum-menu-panel-tools");
    return { panelBg: getComputedStyle(p).backgroundColor };
  });
}
