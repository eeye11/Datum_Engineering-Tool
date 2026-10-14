export default async function run(page, ui) {
  return await page.evaluate(() => {
    const engg = Object.keys(window).filter((k) =>
      /^(engg|drawing|dg)/i.test(k),
    );

    return {
      enggGlobals: engg.sort(),
      // Did ANY engineering-drawing script run?
      quantities: typeof window.enggQuantities || typeof window.enggMeasurement,
      // Are the script elements really parsed as scripts?
      scriptTags: [
        ...document.querySelectorAll('script[src*="engineering-drawing"]'),
      ]
        .slice(0, 4)
        .map((s) => ({
          src: s.getAttribute("src"),
          type: s.getAttribute("type") || "(classic)",
        })),
      // Does the drawing section have any element content at all?
      drawingHtmlLength: document.getElementById("drawing")?.innerHTML.length,
      drawingChildTags: [
        ...new Set(
          [...(document.getElementById("drawing")?.children || [])].map(
            (c) => c.tagName + (c.id ? `#${c.id}` : ""),
          ),
        ),
      ],
      bodyCanvases: document.querySelectorAll("canvas").length,
    };
  });
}
