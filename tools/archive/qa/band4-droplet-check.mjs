/*
 * Confirm the droplet's FILL takes the real drawing colour, and that its
 * OUTLINE is the interface ink - then show both at a large size.
 */
export default async function run(page) {
  await page.getByRole("button", { name: "Engineering Drawing" }).click();
  await page.waitForTimeout(400);

  const read = () =>
    page.evaluate(() => {
      const fill = document.querySelector(".drawing-strip-icon-fill");
      const outline = fill?.nextElementSibling;
      const swatch = document.querySelector(".drawing-colour-swatch");
      return {
        colourVar:
          swatch?.style.getPropertyValue("--datum-colour-value") || null,
        fillComputed: fill ? getComputedStyle(fill).fill : null,
        outlineStroke: outline ? getComputedStyle(outline).stroke : null,
      };
    });

  const black = await read();

  await page.evaluate(() => {
    const input = document.getElementById("drawingColor");
    input.value = "#e5bb50";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const gold = await read();

  /* Large review sheet: the drop on three different colours. */
  await page.evaluate(() => {
    const fill = document.querySelector(".drawing-strip-icon-fill");
    const svg = fill.closest("svg");

    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:0;z-index:99999;background:#fff;display:flex;gap:40px;align-items:center;justify-content:center";

    const pane = (label, colour) => {
      const box = document.createElement("div");
      box.style.cssText =
        "display:flex;flex-direction:column;align-items:center;gap:14px;color:#1F2937;font:13px sans-serif";
      const cell = document.createElement("div");
      cell.style.cssText = [
        "width:110px",
        "height:110px",
        "border:1px solid #DCE4E8",
        "border-radius:6px",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "background:#fff",
        "color:#1F2937",
        `--datum-colour-value:${colour}`,
      ].join(";");
      const big = svg.cloneNode(true);
      big.setAttribute("width", "76");
      big.setAttribute("height", "76");
      cell.appendChild(big);
      box.appendChild(cell);
      const cap = document.createElement("div");
      cap.textContent = label;
      box.appendChild(cap);
      return box;
    };

    host.appendChild(pane("fill #000000", "#000000"));
    host.appendChild(pane("fill #ffffff", "#ffffff"));
    host.appendChild(pane("fill #e5bb50", "#e5bb50"));
    document.body.appendChild(host);
  });

  await page.waitForTimeout(200);
  return { black, gold };
}
