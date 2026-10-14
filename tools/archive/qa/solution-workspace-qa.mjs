// Drive the Written Solution workspace: type a solution, check the outline,
// figures and equations parse, the preview renders, the layout modes and the
// resizer work, and nothing throws.
const SAMPLE = [
  "\\section{Introduction}",
  "A simply supported beam carries a point load at midspan.",
  "",
  "\\begin{problem}",
  "Find the reaction at A.",
  "\\end{problem}",
  "",
  "\\subsection{Equilibrium}",
  "Taking moments about B:",
  "\\[ \\sum M_B = 0 \\]",
  "",
  "\\begin{equation}",
  "R_A = \\frac{w L}{2}",
  "\\end{equation}",
  "",
  "\\subsection{Result}",
  "The reaction is \\textbf{positive}, so it acts upward.",
  "",
].join("\n");

export default async function run(page) {
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  // Open the Written Solution tab.
  const tab = page.getByText("Written Solution", { exact: true }).first();

  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(800);
  }

  await page.waitForSelector("#solutionWorkspace", { timeout: 15000 });

  const out = {};

  // Type the sample into the editor.
  await page.click("#solutionEditor");
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.type(SAMPLE);
  await page.waitForTimeout(1200);

  out.editor = await page.evaluate(() => {
    const e = document.getElementById("solutionEditor");
    return { chars: e.value.length, lines: e.value.split("\n").length };
  });

  out.gutterLines = await page.$$eval(
    "#solutionEditorGutter .solution-gutter-line",
    (els) => els.length,
  );

  out.outline = await page.$$eval(
    "#solutionStructureTree .solution-tree-row",
    (els) =>
      els.map((el) => ({
        number: el.querySelector(".solution-tree-number")?.textContent,
        label: el.querySelector(".solution-tree-label")?.textContent,
      })),
  );

  out.treeGroups = await page.$$eval(
    "#solutionStructureTree .solution-tree-group",
    (els) => els.map((e) => e.textContent),
  );

  // The preview should have rendered content (MathJax output + prose).
  out.preview = await page.evaluate(() => {
    const p = document.getElementById("solutionPreview");
    return {
      childCount: p.childElementCount,
      chars: p.textContent.length,
      hasMath: !!p.querySelector("mjx-container, .MathJax, math, svg"),
      state: document.getElementById("solutionPreviewState")?.textContent || "",
    };
  });

  // Layout modes.
  const modes = {};
  for (const mode of ["write", "read", "split"]) {
    await page.click(`[data-layout-mode="${mode}"]`);
    await page.waitForTimeout(250);
    modes[mode] = await page.evaluate(() => {
      const root = document.getElementById("solutionWorkspace");
      const nav = document.querySelector(".solution-nav");
      const ed = document.querySelector(".solution-editor-panel");
      const pv = document.querySelector(".solution-preview-panel");
      const vis = (el) => (el ? el.getBoundingClientRect().width > 4 : false);
      return {
        attr: root.dataset.layout,
        nav: vis(nav),
        editor: vis(ed),
        preview: vis(pv),
      };
    });
  }
  out.modes = modes;

  // Zoom.
  await page.click("#solutionZoomIn");
  await page.waitForTimeout(200);
  out.zoom = await page.evaluate(() => ({
    label: document.getElementById("solutionZoomValue")?.textContent,
    transform: document.getElementById("solutionPreviewStage")?.style.transform,
  }));

  // The document name is editable.
  await page.fill("#solutionDocumentName", "Beam Analysis Solution");
  await page.dispatchEvent("#solutionDocumentName", "change");
  await page.waitForTimeout(200);
  out.docName = await page.inputValue("#solutionDocumentName");

  return { out, errors: errors.slice(0, 12) };
}
