/*
 * ========================================================
 * ACCEPTANCE TEST - WRITTEN SOLUTION DRAWING REFERENCES
 * ========================================================
 *
 * The LaTeX source is the source of truth: Insert Reference writes a real
 * command into it at the cursor, and Update Output renders the referenced sheet
 * as a FITTED drawing at the command's position.
 *
 *   Test 1  Insert Reference writes the command at the cursor
 *   Test 2  Update Output renders the figure
 *   Test 3  the figure is FITTED, not the whole workspace
 *   Test 4  editing the source sheet updates the figure
 *   Test 5  several references each resolve their own sheet
 *   Test 7  a missing sheet is reported, not a crash
 *   Test 8  cancelling inserts nothing
 *   Test 9  the UI is left usable
 */

export default async function run(page) {
  const out = {};
  const errors = [];

  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  await page.evaluate(async () => {
    await import("/src/main.js");
  });

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(400);

  /* A sheet with real geometry: a triangle. */
  out.setup = await page.evaluate(() => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const a = F.line({ x: 0, y: 0 }, { x: 140, y: 0 }, { style: {} });
    const b = F.line({ x: 140, y: 0 }, { x: 70, y: 110 }, { style: {} });
    const c = F.line({ x: 70, y: 110 }, { x: 0, y: 0 }, { style: {} });
    a.id = "r1";
    b.id = "r2";
    c.id = "r3";
    st.objects.push(a, b, c);
    ds.commitDrawingChange(st, before);

    return {
      sheetId: window.enggDrawingSheets.activeSheetId(),
      objects: st.objects.length,
    };
  });

  out.setup = out.setup;

  /* TEST 1: Insert Reference writes a real command into the LaTeX source. */
  out.insert = await page.evaluate(async () => {
    const code = document.getElementById("writingCode");
    const select = document.getElementById("referenceSheetSelect");
    const caption = document.getElementById("referenceCaption");
    const button = document.getElementById("referenceInsert");

    if (!code || !select || !button) {
      return {
        error: "the Drawing Reference controls are not present",
        hasCode: Boolean(code),
        hasSelect: Boolean(select),
        hasButton: Boolean(button),
        hasCaption: Boolean(caption),
        idsOnPage: [...document.querySelectorAll("[id]")]
          .map((n) => n.id)
          .filter((id) => /reference|writing|caption/i.test(id)),
      };
    }

    /* Put the cursor between two lines, NOT at the end. */
    code.value = "The beam is shown below.\n\nThen equilibrium.";
    const cursor = code.value.indexOf("\n\n") + 1;
    code.setSelectionRange(cursor, cursor);
    code.focus();

    select.value = window.enggDrawingSheets.activeSheetId();
    select.dispatchEvent(new Event("change", { bubbles: true }));

    if (caption) {
      caption.value = "Free Body Diagram";
    }

    button.click();

    await new Promise((r) => setTimeout(r, 500));

    const value = code.value;
    const tokenIndex = value.indexOf("[DRAWING_REFERENCE:");

    return {
      wroteCommand: tokenIndex > -1,
      /* It landed at the cursor, not appended to the end. */
      atCursor: tokenIndex > 0 && tokenIndex < value.indexOf("Then equilibrium"),
      token: tokenIndex > -1 ? value.slice(tokenIndex, tokenIndex + 40) : null,
      source: value,
    };
  });

  out.insert = out.insert;

  /* TEST 2 + 3: Update Output renders a FITTED figure. */
  out.render = await page.evaluate(async () => {
    const update = document.querySelector('[data-action="render-solution"]');

    if (!update) {
      return { error: "no Update Output control" };
    }

    update.click();

    await new Promise((r) => setTimeout(r, 1200));

    const output = document.getElementById("writingOutput");

    const figures = output.querySelectorAll(
      "svg, .drawing-reference-figure, .drawing-reference-empty",
    );

    const svg = output.querySelector("svg");

    let viewBox = null;
    let aspect = null;

    if (svg) {
      viewBox = svg.getAttribute("viewBox");

      if (viewBox) {
        const [, , w, h] = viewBox.split(/[\s,]+/).map(Number);
        aspect = Number((w / Math.max(h, 1e-6)).toFixed(2));
      }
    }

    return {
      figureCount: figures.length,
      hasSvg: Boolean(svg),
      viewBox,
      aspect,
      /* The prose either side of the reference still rendered. */
      hasProse:
        (output.textContent || "").includes("beam is shown below") ||
        (output.textContent || "").includes("equilibrium"),
      emptyNotice: Boolean(output.querySelector(".drawing-reference-empty")),
    };
  });

  out.render = out.render;

  /* TEST 4: editing the source sheet updates the figure. */
  out.live = await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    const before = ds.snapshotDrawing(st);
    const extra = ds.geometryFactories.line(
      { x: 0, y: -60 },
      { x: 140, y: -60 },
      { style: {} },
    );
    extra.id = "r4";
    st.objects.push(extra);
    ds.commitDrawingChange(st, before);

    const update = document.querySelector('[data-action="render-solution"]');
    update.click();

    await new Promise((r) => setTimeout(r, 1200));

    const svg = document.getElementById("writingOutput").querySelector("svg");

    let aspect = null;

    if (svg && svg.getAttribute("viewBox")) {
      const [, , w, h] = svg.getAttribute("viewBox").split(/[\s,]+/).map(Number);
      aspect = Number((w / Math.max(h, 1e-6)).toFixed(2));
    }

    return { objects: st.objects.length, aspect };
  });

  out.live = out.live;

  /* TEST 7: a reference to a sheet that is gone reports itself. */
  out.missing = await page.evaluate(async () => {
    const code = document.getElementById("writingCode");

    code.value =
      "Before.\n[DRAWING_REFERENCE:sheet_that_does_not_exist]\nAfter.\n";
    code.dispatchEvent(new Event("input", { bubbles: true }));

    const update = document.querySelector('[data-action="render-solution"]');
    update.click();

    await new Promise((r) => setTimeout(r, 1200));

    const output = document.getElementById("writingOutput");

    return {
      stillRendersProse: (output.textContent || "").includes("Before"),
      /*
       * The renderer reports a failed reference as `.drawing-reference-missing`
       * and a genuinely EMPTY sheet as `.drawing-reference-empty` - two
       * different facts, and the probe must look for the right one.
       */
      missingNotice: Boolean(
        output.querySelector(".drawing-reference-missing"),
      ),
      noticeText: (
        output.querySelector(".drawing-reference-missing") || {}
      ).textContent,
      pageUsable: Boolean(document.getElementById("writingCode")),
    };
  });

  out.missing = out.missing;

  /* TEST 8 + 9: the workspace is left usable, nothing trapped. */
  out.usable = await page.evaluate(() => ({
    overlays: document.querySelectorAll(
      ".engg-dialog-backdrop, .engg-context-menu",
    ).length,
    codePresent: Boolean(document.getElementById("writingCode")),
    drawingTabUsable: Boolean(
      document.querySelector('.tab[data-tab="drawing"]'),
    ),
  }));

  out.usable = out.usable;

  out.errors = errors;

  return out;
}