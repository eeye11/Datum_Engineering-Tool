/*
 * ========================================================
 * ACCEPTANCE TEST - CONSTRAIN, LOCK, AND THE THREE-DOT MENU
 * ========================================================
 *
 * Three visible bugs, checked against the real UI:
 *
 *   1. Constraining a point must not make the constrain control disappear.
 *   2. `Locked` belongs with POSITION, as a compact boolean.
 *   3. Clicking a three-dot menu must NOT close the Open page.
 */

export default async function run(page) {
  const out = { steps: [] };

  await page.evaluate(async () => {
    await import("/src/main.js");
  });

  await page.waitForFunction(
    () => typeof window.enggDrawing === "object" && window.enggDrawing.state,
    null,
    { timeout: 60000 },
  );

  await page.waitForTimeout(400);

  /* A point, selected, with the feature editor showing. */
  await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;

    /* Show the feature editor rather than the component tree. */
    window.enggEditorState.featurePanelView = "edit";

    const before = ds.snapshotDrawing(st);
    st.objects = [];

    const point = {
      id: "point_c",
      type: "point",
      name: "Point 1",
      geometry: { position: { x: 25, y: 40 } },
      style: { stroke: "#000000", lineWidth: 1 },
    };

    st.objects.push(point);
    ds.commitDrawingChange(st, before);
    ds.selectObject(st, "point_c");

    window.enggEditorState.featurePanelView = "edit";

    const toggle = document.getElementById("drawingFeaturesPanelToggle");
    if (toggle) {
      toggle.click();
    }

    await new Promise((r) => setTimeout(r, 300));
  });

  const panel = () =>
    page.evaluate(() => {
      const host = document.querySelector("#drawingProperties");

      const lock = host.querySelector("[data-feature-lock]");
      const fixes = [...host.querySelectorAll("[data-fix]")].map((n) => ({
        key: n.dataset.fix,
        checked: n.checked,
        title: n.closest("label") ? n.closest("label").title : null,
      }));

      return {
        text: (host.innerText || "").replace(/\n+/g, " | ").slice(0, 220),
        fixCount: fixes.length,
        fixes,
        hasLock: Boolean(lock),
        lockChecked: lock ? lock.checked : null,
      };
    });

  out.initialPanel = await panel();

  /* Constrain X, then CHECK THE CONTROL SURVIVES and can be unchecked. */
  out.constrain = await page.evaluate(async () => {
    const host = document.querySelector("#drawingProperties");

    const xFix = [...host.querySelectorAll("[data-fix]")].find(
      (n) => n.dataset.fix === "position.x",
    );

    if (!xFix) {
      return { error: "no X constrain control" };
    }

    xFix.checked = true;
    xFix.dispatchEvent(new Event("change", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 300));

    const after = document.querySelector("#drawingProperties");

    const again = [...after.querySelectorAll("[data-fix]")].find(
      (n) => n.dataset.fix === "position.x",
    );

    const st = window.enggDrawing.state;
    const object = st.objects.find((o) => o.id === "point_c");

    return {
      controlStillPresent: Boolean(again),
      checked: again ? again.checked : null,
      constraintInModel: object.constraints?.["position.x"] === true,
      controlCount: after.querySelectorAll("[data-fix]").length,
    };
  });

  out.constrainSurvives = out.constrain;

  /* Uncheck it — no Undo needed. */
  out.unconstrain = await page.evaluate(async () => {
    const host = document.querySelector("#drawingProperties");

    const xFix = [...host.querySelectorAll("[data-fix]")].find(
      (n) => n.dataset.fix === "position.x",
    );

    if (!xFix) {
      return { error: "the control disappeared after constraining" };
    }

    xFix.checked = false;
    xFix.dispatchEvent(new Event("change", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 300));

    const after = document.querySelector("#drawingProperties");

    const st = window.enggDrawing.state;
    const object = st.objects.find((o) => o.id === "point_c");

    return {
      stillPresent: Boolean(
        [...after.querySelectorAll("[data-fix]")].find(
          (n) => n.dataset.fix === "position.x",
        ),
      ),
      constraintCleared: object.constraints?.["position.x"] !== true,
    };
  });

  out.unconstrainSurvives = out.unconstrain;

  /* Lock a beam: the control is compact and lives with POSITION. */
  out.lock = await page.evaluate(async () => {
    const ds = window.enggDrawingState;
    const st = window.enggDrawing.state;
    const F = ds.geometryFactories;

    const before = ds.snapshotDrawing(st);
    const beam = F.beam({ x: 0, y: 0 }, { x: 300, y: 0 }, { style: {} });
    beam.id = "beam_lockui";
    st.objects.push(beam);
    ds.commitDrawingChange(st, before);
    ds.selectObject(st, "beam_lockui");

    window.enggEditorState.featurePanelView = "edit";

    const toggle = document.getElementById("drawingFeaturesPanelToggle");
    if (toggle) {
      toggle.click();
    }

    await new Promise((r) => setTimeout(r, 350));

    const host = document.querySelector("#drawingProperties");
    const text = (host.innerText || "").replace(/\n+/g, " | ");

    const lock = host.querySelector("[data-feature-lock]");

    return {
      hasLock: Boolean(lock),
      lockTitle: lock ? lock.closest("label").title : null,
      positionBeforeLock:
        text.indexOf("End Y") > -1 &&
        text.indexOf("Locked") > text.indexOf("End Y"),
      lockInPositionSection:
        text.indexOf("POSITION") > -1 &&
        text.indexOf("Locked") > text.indexOf("POSITION") &&
        text.indexOf("Locked") < text.indexOf("ORIENTATION"),
    };
  });

  out.lockPlacement = out.lock;

  /* Toggle the lock on and off — the control must survive both. */
  out.lockToggle = await page.evaluate(async () => {
    const host = document.querySelector("#drawingProperties");
    const input = host.querySelector("[data-feature-lock]");

    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 250));

    const afterOn = document.querySelector("[data-feature-lock]");

    const object = window.enggDrawing.state.objects.find(
      (o) => o.id === "beam_lockui",
    );

    afterOn.checked = false;
    afterOn.dispatchEvent(new Event("change", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 250));

    const afterOff = document.querySelector("[data-feature-lock]");

    return {
      survivedOn: Boolean(afterOn),
      survivedOff: Boolean(afterOff),
      finalLocked: Boolean(object.locked),
    };
  });

  out.lockToggle = out.lockToggle;

  /* The three-dot menu must not close the Open page. */
  out.threeDot = await page.evaluate(async () => {
    /* One recent, so there is a card to manage. */
    window.enggRecentFiles.remember({
      name: "triangle.enggdraw",
      document: {
        units: "mm",
        sheets: [{ id: "s", objects: [] }],
        activeSheetId: "s",
      },
    });

    document.querySelector('[data-file-action="open"]').click();
    await new Promise((r) => setTimeout(r, 500));

    const openBefore = (document.querySelector(".engg-dialog-title") || {})
      .textContent;

    const menu = document.querySelector(".datum-open-recent-menu");

    if (!menu) {
      return { error: "no recent three-dot button", openBefore };
    }

    menu.click();
    await new Promise((r) => setTimeout(r, 350));

    const openAfter = (document.querySelector(".engg-dialog-title") || {})
      .textContent;

    const contextMenu = document.querySelector(".engg-context-menu");

    const items = contextMenu
      ? [...contextMenu.querySelectorAll(".engg-context-menu-item")].map(
          (n) => n.textContent,
        )
      : [];

    return {
      openBefore,
      openAfter,
      openStillOpen: openAfter === "Open",
      contextMenuOpened: Boolean(contextMenu),
      items,
    };
  });

  out.threeDot = out.threeDot;

  /* Escape closes the MENU and leaves the Open page alone. */
  out.menuEscape = await page.evaluate(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    await new Promise((r) => setTimeout(r, 250));

    return {
      menuClosed: !document.querySelector(".engg-context-menu"),
      openStillOpen:
        (document.querySelector(".engg-dialog-title") || {}).textContent ===
        "Open",
    };
  });

  out.menuEscape = out.menuEscape;

  return out;
}
