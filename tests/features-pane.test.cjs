/*
 * ========================================================
 * THE OBJECTS AND FEATURES TABS, IN THE BOOTED APPLICATION
 * ========================================================
 *
 * These check the CONTRACT rather than the markup:
 *
 *   - Features is empty when nothing is selected, and empty again afterwards;
 *   - selecting an object shows that object's real values;
 *   - a mixed selection shows a mixed state and preserves every original value
 *     until a deliberate edit;
 *   - an edit reaches only the selected objects that support the field;
 *   - Objects is an inventory - icon, name, selection - and never an editor;
 *   - Transform moves real geometry, by the real increment, and holds a fixed
 *     object still.
 *
 * The application is booted from the real page, so the pane that is tested is
 * the pane that ships, wired to the real modules.
 */
const path = require("path");
const { bootApp, whenReady } = require("./helpers/boot-app.cjs");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`);
  }
};

const { window, document, error } = bootApp();

if (error) {
  console.log(`  the application did not boot: ${error.message}`);
  process.exit(1);
}

const fire = (element, type) => {
  element.dispatchEvent(new window.Event(type, { bubbles: true }));
};

/* Setting a value the way a control does, then announcing it. */
const setValue = (element, value) => {
  element.value = value;
  fire(element, "change");
};

(async () => {
  await whenReady();

  const { locate } = require("./helpers/source-path.cjs");
  const src = (file) => require(locate(path.basename(file)));

  const model = src("src/shared/model/drawing-state.js").default;
  const { drawingState } = src("features/workspace/editor-state.js");
  const { renderFeatures } = src("src/components/layout/panels/features-pane.js");
  const { renderObjects } = src("src/components/layout/panels/objects-pane.js");

  const body = document.getElementById("drawingFeatures");
  const objectsHost = document.getElementById("drawingObjects");

  const field = (key) => body.querySelector(`[data-feature-field="${key}"]`);
  const group = (id) => body.querySelector(`[data-feature-group="${id}"]`);

  /*
   * A COLOUR PROPERTY IS A BUTTON, NOT AN INPUT.
   *
   * It opens the shared picker (`shared/ui/colour-picker.js`) - the same popup
   * the top toolbar's drawing colour uses - so the value it holds is a
   * `data-value` attribute rather than an `<input type="color">` value.
   */
  const swatch = (key) => body.querySelector(`[data-feature-colour="${key}"]`);

  /* A segmented choice is a group of buttons. */
  const choice = (key, value) =>
    value === undefined
      ? body.querySelector(`[data-feature-choice="${key}"]`)
      : body.querySelector(`[data-feature-choice="${key}"][data-value="${value}"]`);

  const add = (object) => {
    const before = model.snapshotDrawing(drawingState);
    const stored = model.addObject(drawingState, object);
    model.commitDrawingChange(drawingState, before);

    return stored;
  };

  const factories = model.geometryFactories;

  /* ====================================================== nothing selected */

  console.log("\nNothing selected");
  console.log("----------------");

  model.clearSelection(drawingState);
  renderFeatures();

  check("Features is completely empty", body.innerHTML === "", body.innerHTML.slice(0, 120));
  check("with no heading and no controls", !body.querySelector("*"));
  check("and the pane reports an empty selection", body.dataset.selectionCount === "0");

  /*
   * AN ARMED TOOL IS NOT A SELECTION. Activating the polygon tool while nothing
   * is selected must leave the pane exactly as empty as it was.
   */
  drawingState.activeTool = "polygon";
  document.dispatchEvent(new window.CustomEvent("datum:tool-changed", { detail: { toolId: "polygon" } }));

  check("activating a drawing tool does not fill Features", body.innerHTML === "");
  drawingState.activeTool = "select";

  /* ====================================================== a Line */

  console.log("\nOne Line selected");
  console.log("-----------------");

  /*
   * The width starts as the "thin" preset (0.5), which is what the application
   * gives a new object. A preset is the only thing Custom can be chosen FROM,
   * so starting anywhere else would test a state the panel cannot reach.
   */
  const line = add(
    factories.line({ x: 10, y: 20 }, { x: 60, y: 20 }, {
      style: {
        stroke: "#112233",
        lineWidth: "thin",
        lineType: "solid",
        arrowStart: "none",
        arrowEnd: "filled"
      }
    })
  );

  model.selectObject(drawingState, line.id);
  renderFeatures();

  check("the header names the object", body.querySelector(".dfp-header-name")?.textContent === line.name, body.querySelector(".dfp-header-name")?.textContent);
  check("a Line heading appears", Boolean(group("line")), body.innerHTML.slice(0, 200));
  check("Line style shows the object's own value", field("lineType")?.value === "solid");
  check("Begin Arrow and End Arrow are two independent controls", Boolean(field("arrowStart")) && Boolean(field("arrowEnd")));
  check("the End Arrow shows the stored Filled Arrow", field("arrowEnd")?.value === "filled", field("arrowEnd")?.value);
  check("the Begin Arrow shows None", field("arrowStart")?.value === "none");
  check(
    "Appearance shows the object's colour",
    swatch("stroke")?.dataset.value === "#112233",
    swatch("stroke")?.dataset.value,
  );
  check(
    "the swatch shows that colour as text",
    swatch("stroke")?.querySelector(".dfp-colour-text")?.textContent === "#112233",
    swatch("stroke")?.querySelector(".dfp-colour-text")?.textContent,
  );
  check("Thickness shows the object's width as its preset", field("lineWidth")?.value === "thin", field("lineWidth")?.value);
  check("Fixed is offered", Boolean(field("fixed")));
  check("Transform is offered", Boolean(group("transform")) && Boolean(body.querySelector('[data-transform-input="x"]')));
  check("no Construction section is invented", !body.textContent.toLowerCase().includes("construction"));
  check("no numerical geometry fields are shown", !field("sides") && !field("length") && !field("angle"));

  console.log("\nEditing a Line");
  console.log("--------------");

  setValue(field("lineType"), "dashed");
  check("the line style is written to the model", line.style.lineType === "dashed", line.style.lineType);
  check("and only that key changed", line.style.stroke === "#112233" && line.style.lineWidth === "thin");
  check("the End Arrow survived the style edit", line.style.arrowEnd === "filled");

  setValue(field("arrowStart"), "bar");
  check("Begin Arrow writes independently", line.style.arrowStart === "bar" && line.style.arrowEnd === "filled");

  setValue(field("lineWidth"), "thick");
  check("Thickness writes the preset's width", line.style.lineWidth === 1, String(line.style.lineWidth));
  check("and the arrow heads are untouched", line.style.arrowStart === "bar" && line.style.arrowEnd === "filled");

  /*
   * CUSTOM IS A CHOICE, NOT A WIDTH. Choosing it changes nothing in the model -
   * the object keeps the preset width it had - so the pane must still switch to
   * the numeric field. The value the student then types is what moves.
   */
  setValue(field("lineWidth"), "custom");
  check("choosing Custom leaves the stored width alone", line.style.lineWidth === 1, String(line.style.lineWidth));
  check("Thickness is a dropdown, as a six-way choice should be", field("lineWidth")?.tagName === "SELECT", field("lineWidth")?.tagName);
  check("choosing Custom reveals a width field", Boolean(field("customWidth")), String(field("lineWidth")?.value));
  setValue(field("customWidth"), "1.75");
  check("the custom width is stored", line.style.lineWidth === 1.75, String(line.style.lineWidth));

  field("fixed").checked = true;
  fire(field("fixed"), "change");
  check("Fixed locks the object", line.locked === true);

  field("fixed").checked = false;
  fire(field("fixed"), "change");
  check("and unlocking removes the lock", line.locked === false || line.locked === undefined);

  /* ====================================================== a Point */

  console.log("\nA Point");
  console.log("-------");

  const point = add(factories.point({ x: 200, y: 50 }, {}));
  model.selectObject(drawingState, point.id);
  renderFeatures();

  check("Marker offers a style", Boolean(choice("markerStyle")));
  check("Marker offers a size", Boolean(choice("markerSize")));
  check("a Point has no Line section", !group("line"));
  check("and no Fill section", !group("fill"));

  body.querySelector('[data-feature-choice="markerStyle"][data-value="cross"]').click();
  check("pressing Cross writes the marker style", point.style.markerStyle === "cross", point.style.markerStyle);

  body.querySelector('[data-feature-choice="markerSize"][data-value="large"]').click();
  check("pressing Large writes the marker size", point.style.markerSize === "large", point.style.markerSize);
  check("and the Style choice was preserved", point.style.markerStyle === "cross");

  /* ====================================================== a Polygon */

  console.log("\nA Polygon");
  console.log("---------");

  const polygon = add(
    model.createGeometryObject("polygon", { center: { x: 0, y: 0 }, radius: 40, sides: 6, rotation: 0 }, {})
  );
  model.selectObject(drawingState, polygon.id);
  renderFeatures();

  check("Shape offers Number of Sides", Boolean(field("sides")) || Boolean(body.querySelector('[data-feature-field="sides"]')));
  const sidesField = field("sides");
  check("showing the polygon's own side count", Number(sidesField?.value) === 6, sidesField?.value);
  check("with a floor of 3", sidesField?.getAttribute("min") === "3");
  check("and increments of one", sidesField?.getAttribute("step") === "1", sidesField?.getAttribute("step"));

  setValue(sidesField, "9");
  check("a new side count reaches the geometry", polygon.geometry.sides === 9, String(polygon.geometry.sides));

  sidesField.value = "2";
  fire(sidesField, "change");
  check("a side count below three is refused", polygon.geometry.sides === 9, String(polygon.geometry.sides));

  /* ====================================================== fill */

  console.log("\nFill");
  console.log("----");

  model.selectObject(drawingState, polygon.id);
  renderFeatures();

  check("Fill Mode is offered on a closed shape", Boolean(body.querySelector('[data-feature-choice="fillMode"]')));
  check("Fill Colour is hidden while the mode is None", !swatch("fill"));

  body.querySelector('[data-feature-choice="fillMode"][data-value="solid"]').click();
  check("choosing Solid writes the fill mode", polygon.style.fillMode === "solid", polygon.style.fillMode);
  check("and reveals the Fill Colour control", Boolean(swatch("fill")), body.innerHTML.slice(0, 200));

  /*
   * A COLOUR IS CHOSEN THROUGH THE SHARED PICKER, so the test drives the same
   * path the student does: the swatch opens it, and a palette cell applies the
   * colour. The popup is found on the document, because that is where it lives -
   * it is not nested in the panel.
   */
  swatch("fill").click();

  const palette = [...document.querySelectorAll(".drawing-colour-popup .drawing-colour-cell")];

  check("the shared picker opens from the fill swatch", palette.length > 0, String(palette.length));
  check(
    "and it is the toolbar's own picker, with a custom colour and recents",
    Boolean(document.querySelector("[data-colour-custom]")) &&
      Boolean(document.querySelector("[data-colour-recent]")),
  );

  palette[5].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  check("choosing a colour stores it on the fill", /^#[0-9a-f]{6}$/.test(polygon.style.fill), polygon.style.fill);
  check("and closes the picker", !document.querySelector(".drawing-colour-popup"));
  check("and the outline colour is untouched", polygon.style.stroke !== polygon.style.fill);

  /* ====================================================== coordinate system */

  console.log("\nA Coordinate System");
  console.log("-------------------");

  const axes = add(
    model.createGeometryObject(
      "coordinate-system-2d",
      { origin: { x: 0, y: 0 }, axisLength: 25 },
      { name: "Axes" }
    )
  );
  model.selectObject(drawingState, axes.id);
  renderFeatures();

  check("Axes offers the X axis", Boolean(field("showXAxis")));
  check("Axes offers the Y axis", Boolean(field("showYAxis")));
  check("Labels offers Show Labels", Boolean(field("showLabels")));
  check("with the default X label", field("xLabel")?.value === "x", field("xLabel")?.value);
  check("the default Y label", field("yLabel")?.value === "y", field("yLabel")?.value);
  check("the default origin label", field("originLabel")?.value === "O", field("originLabel")?.value);

  setValue(field("originLabel"), "0");
  check("the origin label is stored", axes.geometry.originLabel === "0", axes.geometry.originLabel);
  check("and the axis labels are untouched", field("xLabel")?.value === "x");

  field("showYAxis").checked = false;
  fire(field("showYAxis"), "change");
  check("hiding an axis is stored", axes.geometry.showYAxis === false);

  /* ====================================================== mixed values */

  console.log("\nTwo Lines with different values");
  console.log("-------------------------------");

  const line2 = add(
    factories.line({ x: 0, y: 0 }, { x: 30, y: 0 }, {
      style: { stroke: "#445566", lineWidth: "medium", lineType: "dotted", arrowStart: "open", arrowEnd: "none" }
    })
  );

  model.selectObjects(drawingState, [line.id, line2.id]);
  renderFeatures();

  check("the header reports the selection size", body.querySelector(".dfp-header-name")?.textContent === "2 objects", body.querySelector(".dfp-header-name")?.textContent);
  check("the Line style is a mixed state", field("lineType")?.dataset.mixed === "true" && field("lineType")?.value === "");
  check("the mixed style has no option selected as a value", field("lineType")?.selectedOptions?.[0]?.disabled === true);
  check("the colour is a mixed swatch", swatch("stroke")?.classList.contains("is-mixed") && swatch("stroke")?.dataset.mixed === "true");
  check("the thickness is mixed", field("lineWidth")?.dataset.mixed === "true" && field("lineWidth")?.value === "");
  check("the Begin Arrow is mixed", field("arrowStart")?.dataset.mixed === "true");
  check("the End Arrow is mixed", field("arrowEnd")?.dataset.mixed === "true");

  check("every original line style is still intact", line.style.lineType === "dashed" && line2.style.lineType === "dotted");
  check("every original colour is still intact", line.style.stroke === "#112233" && line2.style.stroke === "#445566");
  check("every original arrow is still intact", line.style.arrowStart === "bar" && line2.style.arrowStart === "open");

  setValue(field("lineType"), "solid");
  check("setting the mixed style sets both lines", line.style.lineType === "solid" && line2.style.lineType === "solid");
  check("without touching their colours", line.style.stroke === "#112233" && line2.style.stroke === "#445566");
  check("or their thicknesses", line.style.lineWidth !== line2.style.lineWidth, `${line.style.lineWidth} / ${line2.style.lineWidth}`);

  /* ====================================================== mixed types */

  console.log("\nA Line and a Circle");
  console.log("-------------------");

  const circle = add(factories.circle({ x: 0, y: 0 }, 20, { style: { stroke: "#112233", lineWidth: 0.75 } }));

  model.selectObjects(drawingState, [line.id, circle.id]);
  renderFeatures();

  check("shared Appearance is offered", Boolean(swatch("stroke")) && Boolean(field("lineWidth")));
  check("the Line's own arrow fields are still offered for it", Boolean(field("arrowStart")) && Boolean(field("arrowEnd")));
  check("the Circle's Fill is offered", Boolean(body.querySelector('[data-feature-choice="fillMode"]')));
  check("no Number of Sides, as no polygon is selected", !field("sides"));

  /*
   * THE SHARED COLOUR REACHES BOTH, THROUGH THE PICKER. This is the check that
   * a multi-object colour edit still lands on every compatible object now that
   * the control is the shared popup rather than a native input.
   */
  swatch("stroke").click();

  const sharedPalette = [...document.querySelectorAll(".drawing-colour-popup .drawing-colour-cell")];

  sharedPalette[11].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  check(
    "setting the shared colour reaches both objects",
    line.style.stroke === circle.style.stroke && /^#[0-9a-f]{6}$/.test(line.style.stroke),
    `${line.style.stroke} / ${circle.style.stroke}`,
  );
  check("and does not touch the Circle's fill", circle.style.fill === "none" || circle.style.fill === undefined);

  body.querySelector('[data-feature-choice="fillMode"][data-value="solid"]').click();
  check("setting Fill reaches the Circle", circle.style.fillMode === "solid");
  check("and does not give the Line a fill", line.style.fillMode === undefined, String(line.style.fillMode));

  /* ====================================================== Mixed with a subset */

  console.log("\nA Polygon and a Line: Number of Sides for the subset");
  console.log("---------------------------------------------------");

  model.selectObjects(drawingState, [polygon.id, line.id]);
  renderFeatures();

  check("Number of Sides is offered when a polygon is selected", Boolean(field("sides")));
  setValue(field("sides"), "7");
  check("it reaches the polygon", polygon.geometry.sides === 7, String(polygon.geometry.sides));
  check("and leaves the line alone", line.geometry.start.x === 10 && line.geometry.end.x === 60);

  /* ====================================================== Mixed fixed states */

  console.log("\nMixed Fixed states");
  console.log("------------------");

  line.locked = true;
  circle.locked = undefined;
  model.selectObjects(drawingState, [line.id, circle.id]);
  renderFeatures();

  const fixedBox = field("fixed");
  check("Fixed shows an indeterminate state", fixedBox?.indeterminate === true);
  check("and is not drawn as checked", fixedBox?.checked === false);

  fixedBox.checked = true;
  fire(fixedBox, "change");
  check("setting it on fixes every compatible object", line.locked === true && circle.locked === true);

  /* ====================================================== transform */

  console.log("\nTransform");
  console.log("---------");

  /*
   * A polygon of its own, so the transform checks are not confused by the
   * earlier fixed state or by a line whose ends are being measured.
   */
  const mover = add(
    model.createGeometryObject("polygon", { center: { x: 100, y: 100 }, radius: 20, sides: 6, rotation: 0 }, {
      style: { stroke: "#112233", lineWidth: 0.75 }
    })
  );

  model.selectObject(drawingState, mover.id);
  renderFeatures();

  /*
   * THE CONTROLS ARE RE-QUERIED AFTER EVERY ACTION.
   *
   * A transform redraws the canvas, and the redraw re-renders this pane - so the
   * elements a click just used are replaced. A test that held one reference would
   * be pressing a detached button and then reading a detached box, which is not
   * what the student does: they press whatever the panel is showing now.
   */
  const xInput = () => body.querySelector('[data-transform-input="x"]');
  const yInput = () => body.querySelector('[data-transform-input="y"]');
  const rotateInput = () => body.querySelector('[data-transform-input="rotate"]');
  const step = (axis, direction) =>
    body.querySelector(`[data-transform-step="${axis}"][data-direction="${direction}"]`).click();

  check(
    "X Shift, Y Shift and Rotate each have an input",
    Boolean(xInput() && yInput() && rotateInput()),
  );
  check(
    "each starts at zero",
    xInput().value === "0" && yInput().value === "0" && rotateInput().value === "0",
  );
  check(
    "each has an up and a down arrow",
    body.querySelectorAll('[data-transform-step="x"]').length === 2 &&
      body.querySelectorAll('[data-transform-step="y"]').length === 2 &&
      body.querySelectorAll('[data-transform-step="rotate"]').length === 2
  );

  step("x", 1);
  check("the X up arrow moves right by 0.1", Math.abs(mover.geometry.center.x - 100.1) < 1e-9, String(mover.geometry.center.x));
  check("the Y position did not move", Math.abs(mover.geometry.center.y - 100) < 1e-9);
  check("and the box records the 0.1 applied", xInput().value === "0.1", xInput().value);

  step("x", -1);
  step("x", -1);
  check("two down clicks move left by 0.2", Math.abs(mover.geometry.center.x - 99.9) < 1e-9, String(mover.geometry.center.x));
  check("the box records −0.1", xInput().value === "-0.1", xInput().value);

  step("y", 1);
  check("the Y up arrow moves up by 0.1", Math.abs(mover.geometry.center.y - 100.1) < 1e-9, String(mover.geometry.center.y));

  const rotationBefore = Number(mover.geometry.rotation) || 0;
  step("rotate", 1);
  check(
    "the Rotate up arrow turns by +0.1 degrees",
    Math.abs(((Number(mover.geometry.rotation) || 0) - rotationBefore) - 0.1) < 1e-9,
    String(mover.geometry.rotation)
  );

  /* Typed values are relative amounts, applied once and then cleared. */
  setValue(xInput(), "2");
  check("a typed X of 2 moves the object 2 units right", Math.abs(mover.geometry.center.x - 101.9) < 1e-9, String(mover.geometry.center.x));
  check("and the field returns to zero", xInput().value === "0", xInput().value);

  const typedRotationBefore = Number(mover.geometry.rotation) || 0;
  setValue(rotateInput(), "-1");
  check(
    "a typed rotation applies that angle",
    Math.abs(((Number(mover.geometry.rotation) || 0) - typedRotationBefore) + 1) < 1e-9,
    String(mover.geometry.rotation)
  );

  /*
   * AND THE BOX RESETS WHEN THE SECTION IS LEFT. The offsets are a temporary
   * adjustment, so going away and coming back must find them at zero - without
   * undoing anything the arrows already did to the drawing.
   */
  step("x", 1);
  check("an arrow records its total", xInput().value === "0.1", xInput().value);

  const movedTo = mover.geometry.center.x;

  body.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));

  check("leaving the section clears the box", xInput().value === "0", xInput().value);
  check(
    "and does NOT undo the transformation",
    Math.abs(mover.geometry.center.x - movedTo) < 1e-9,
    `${mover.geometry.center.x} / ${movedTo}`
  );

  /* ====================================================== transform: fixed */

  console.log("\nTransform with a fixed object in the selection");
  console.log("---------------------------------------------");

  const still = add(
    model.createGeometryObject("polygon", { center: { x: 300, y: 300 }, radius: 20, sides: 6, rotation: 0 }, {})
  );

  still.locked = true;

  model.selectObjects(drawingState, [mover.id, still.id]);
  renderFeatures();

  const beforeGroup = mover.geometry.center.x;

  step("x", 1);

  check(
    "the unfixed object moves by one step",
    Math.abs(mover.geometry.center.x - (beforeGroup + 0.1)) < 1e-9,
    `${mover.geometry.center.x} from ${beforeGroup}`,
  );
  check("the fixed object does not", still.geometry.center.x === 300, String(still.geometry.center.x));

  /* A selection of only fixed objects leaves Transform inert, and says nothing moved. */
  model.selectObject(drawingState, still.id);
  renderFeatures();

  step("x", 1);
  check("a fixed object is not moved by its own Transform controls", still.geometry.center.x === 300, String(still.geometry.center.x));

  still.locked = false;

  /* ====================================================== transform history */

  console.log("\nTransform is one history entry per step");
  console.log("---------------------------------------");

  check("each step is undoable", drawingState.history.past.length > 0);

  const undoBefore = drawingState.history.past.length;
  const xBefore = mover.geometry.center.x;

  step("x", 1);
  check("a step adds exactly one entry", drawingState.history.past.length === undoBefore + 1);

  const last = drawingState.history.past[drawingState.history.past.length - 1];
  const previousMover = (last.objects || last).find?.((object) => object.id === mover.id);
  check(
    "and the entry holds the position before the step",
    previousMover && Math.abs(previousMover.geometry.center.x - xBefore) < 1e-9,
    JSON.stringify(previousMover?.geometry?.center)
  );

  /* ====================================================== Objects */

  console.log("\nObjects");
  console.log("-------");

  /*
   * The circle is selected here explicitly, so this section starts from a known
   * selection rather than from whatever the transform checks happened to leave
   * behind - the list's highlight is the thing under test, not the history of it.
   */
  model.selectObject(drawingState, circle.id);
  renderObjects();

  const rows = [...objectsHost.querySelectorAll("[data-object-id]")];
  check("there is a row per object on the sheet", rows.length === drawingState.objects.length, `${rows.length} / ${drawingState.objects.length}`);
  check("every row has an icon", rows.every((row) => row.querySelector(".drawing-objects-icon svg")));
  check("every row has a name", rows.every((row) => row.querySelector(".drawing-objects-name")?.textContent.trim()));
  check("Objects contains no property grid", !objectsHost.querySelector(".drawing-property-grid, .dfp-row"));

  check("Objects contains no form control", objectsHost.querySelectorAll("input, select, textarea").length === 0);

  /*
   * ROWS ARE LOOKED UP WHEN THEY ARE USED, NOT HELD.
   *
   * Selecting anything re-renders the list, so the row elements a check just
   * read are replaced by the time the next one runs. A held reference would be
   * asserting on a detached node, which is not what the student sees.
   */
  const rowFor = (id) =>
    [...objectsHost.querySelectorAll("[data-object-id]")].find(
      (row) => row.dataset.objectId === id,
    );

  check(
    "the selected object's row is marked selected",
    rowFor(circle.id)?.getAttribute("aria-selected") === "true",
  );

  /*
   * CLICKING A ROW SELECTS THE OBJECT - through the same model call the canvas
   * uses - and a shift-click adds to the selection.
   */
  rowFor(circle.id).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  check("clicking a row selects that object", drawingState.selection.selectedObjectIds.join() === circle.id);

  renderObjects();
  rowFor(line.id).dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));

  check(
    "shift-clicking a second row adds it to the selection",
    drawingState.selection.selectedObjectIds.length === 2 &&
      drawingState.selection.selectedObjectIds.includes(line.id) &&
      drawingState.selection.selectedObjectIds.includes(circle.id)
  );

  renderObjects();
  check(
    "every selected row is highlighted",
    [...objectsHost.querySelectorAll('[data-object-id]')].filter((row) => row.getAttribute("aria-selected") === "true").length === 2
  );

  /* Selecting on the canvas is the same selection the list reads. */
  model.selectObject(drawingState, point.id);
  renderObjects();
  check(
    "a canvas selection moves the highlight in Objects",
    [...objectsHost.querySelectorAll('[data-object-id]')].find((row) => row.dataset.objectId === point.id)?.getAttribute("aria-selected") === "true"
  );

  /* ====================================================== clearing */

  console.log("\nClearing the selection empties Features again");
  console.log("---------------------------------------------");

  model.clearSelection(drawingState);
  renderFeatures();

  check("Features is empty after a deselection", body.innerHTML === "");
  check("and holds no controls", body.querySelectorAll("input, select, button").length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);

  if (fail > 0) {
    process.exitCode = 1;
  }

  /*
   * THE HARNESS IS TOLD THE WORK IS DONE.
   *
   * Booting the whole application installs timers - the source editor's render
   * delay, the canvas's frame scheduler - and an open handle keeps the process
   * alive after the last check, so `npm test` waits on a file that has already
   * finished. Closing the window releases them.
   */
  window.close();
})();
