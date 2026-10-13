/*
 * ========================================================
 * STATICS VALUE PROMPTS, UNITS, AND THE FIXED SUPPORT
 * ========================================================
 *
 * Three requirements, and the thread through all of them is that the tools
 * must belong to ONE system rather than each having its own special case:
 *
 *   1. A typed answer means the same thing everywhere.
 *        number  -> a magnitude
 *        empty   -> UNKNOWN (a real state, not zero and not an error)
 *        other   -> the student's own symbol, kept verbatim
 *
 *   2. A unit control is wide enough to show the unit it is showing.
 *
 *   3. A fixed support is a wall at the END of the member, with its hatching
 *      behind the wall - on the side the body is NOT on.
 */

const { JSDOM } = require("jsdom");

const { modulePath } = require("./helpers/source-path.cjs");

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

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "https://datum.test/",
});

global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;

const popup = require(modulePath("load-value-popup.js"));
const frames = require(modulePath("body-frames.js")).default;
const state = require(modulePath("drawing-state.js")).default;

/* ============================================================
 * WHAT A TYPED ANSWER MEANS
 * ============================================================ */

console.log("\n  a NUMBER is a magnitude\n");

[
  ["250", 250],
  ["12.5", 12.5],
  ["0", 0],
  ["-3.25", -3.25],
  [".5", 0.5],
].forEach(([text, expected]) => {
  const answer = popup.readStaticsValue(text, "N");

  check(
    `"${text}" reads as the number ${expected}`,
    answer.kind === "number" && answer.value === expected,
    JSON.stringify(answer),
  );
});

console.log("\n  an EMPTY box is Unknown - not zero, not an error\n");

["", "   ", null, undefined].forEach((text) => {
  const answer = popup.readStaticsValue(text, "N");

  check(
    `${JSON.stringify(text)} is Unknown`,
    answer.kind === "unknown",
    JSON.stringify(answer),
  );
});

console.log("\n  anything else is the STUDENT'S OWN SYMBOL\n");

["F₁", "F", "M", "P", "W", "L", "q", "θ", "2*M", "(L + W)/2"].forEach(
  (text) => {
    const answer = popup.readStaticsValue(text, "N");

    check(
      `"${text}" is kept verbatim as a symbol`,
      answer.kind === "symbol" && answer.text === text,
      JSON.stringify(answer),
    );
  },
);

console.log("\n  a unit typed IN THE FIELD is read, and the widest units win\n");

{
  const withUnit = popup.readStaticsValue("5 kN·m", "kN·m");

  check(
    "\"5 kN·m\" is the number 5 in kN·m",
    withUnit.kind === "number" &&
      withUnit.value === 5 &&
      withUnit.unit === "kN·m",
    JSON.stringify(withUnit),
  );

  const load = popup.readStaticsValue("2.5 kN/m", "kN/m");

  check(
    "and \"2.5 kN/m\" is not misread as kN",
    load.kind === "number" && load.unit === "kN/m",
    JSON.stringify(load),
  );
}

/* ============================================================
 * APPLYING IT TO A FEATURE
 * ============================================================ */

console.log("\n  the answer is written where the MODEL keeps that state\n");

{
  const make = () => ({
    type: "force",
    geometry: { magnitude: 100 },
    unknownValues: {},
    magnitudeLabel: null,
  });

  /* A number. */
  {
    const object = make();

    popup.applyStaticsValue(object, { kind: "number", value: 250 });

    check(
      "a number sets the geometry's magnitude",
      object.geometry.magnitude === 250,
    );

    check(
      "and clears the Unknown mark",
      object.unknownValues.magnitude === false,
    );

    check("and clears any symbol", object.magnitudeLabel === null);
  }

  /* Unknown. */
  {
    const object = make();

    popup.applyStaticsValue(object, { kind: "unknown" });

    check(
      "Unknown marks the quantity, which is what the panel reads",
      object.unknownValues.magnitude === true,
      JSON.stringify(object.unknownValues),
    );

    check(
      "and REMOVES the number, rather than leaving it under the mark",
      object.geometry.magnitude === undefined,
      `magnitude is ${object.geometry.magnitude}`,
    );
  }

  /* A symbol. */
  {
    const object = make();

    popup.applyStaticsValue(object, { kind: "symbol", text: "F₁" });

    check(
      "a symbol becomes the feature's magnitude label",
      object.magnitudeLabel === "F₁",
      JSON.stringify(object.magnitudeLabel),
    );

    check(
      "and it is NOT turned into zero",
      object.geometry.magnitude === undefined,
      `magnitude is ${object.geometry.magnitude}`,
    );

    check(
      "and it is not marked Unknown - it is a statement the student made",
      object.unknownValues.magnitude === false,
    );
  }

  /* Changing one state clears the others. */
  {
    const object = make();

    popup.applyStaticsValue(object, { kind: "symbol", text: "F₁" });
    popup.applyStaticsValue(object, { kind: "number", value: 250 });

    check(
      "switching from a symbol to a number drops the symbol",
      object.magnitudeLabel === null && object.geometry.magnitude === 250,
      JSON.stringify({
        label: object.magnitudeLabel,
        magnitude: object.geometry.magnitude,
      }),
    );
  }
}

/* ============================================================
 * THE MOMENT PROMPTS, AFTER PLACEMENT
 * ============================================================ */

console.log("\n  a Moment is placed, and THEN asked about\n");

{
  const preview = require("fs").readFileSync(
    modulePath("preview.js"),
    "utf8",
  );

  check(
    "the moment is committed before the popup is opened",
    (() => {
      const addAt = preview.indexOf("addObject(");
      const promptAt = preview.indexOf("openMomentValuePrompt(");

      return addAt > 0 && promptAt > addAt;
    })(),
    "asking first would be asking about something not yet on the sheet",
  );

  check(
    "and it uses the SHARED value popup",
    /\bopenLoadValuePopup\(\{/.test(preview),
    "a bespoke moment dialog would be a second thing to learn",
  );

  check(
    "with MOMENT units, not a force's or a load's",
    /MOMENT_UNITS/.test(preview) &&
      /unitsFor\?.{0,10}moment|kN\u00b7m/.test(preview) &&
      /unitsFor\("moment"\)|unitsFor\?\.\("moment"\)/.test(preview),
  );

  check(
    "and a cancelled prompt KEEPS the placed moment",
    /onCancel[\s\S]{0,300}Moment placed[\s\S]{0,200}renderCurrentDrawing/.test(
      preview,
    ),
    "the student is abandoning the number, not the feature they placed",
  );
}

/* ============================================================
 * UNIT CONTROLS ARE WIDE ENOUGH
 * ============================================================ */

console.log("\n  a unit control is never narrower than its own symbol\n");

{
  const css = require("fs").readFileSync(
    require("path").join(__dirname, "..", "src", "styles", "editor.css"),
    "utf8",
  );

  const popupUnit = css.match(/\.drawing-creation-dimension-unit \{[^}]*\}/);

  check(
    "the popup's unit control has NO fixed width",
    popupUnit && !/min-width:\s*\d+px/.test(popupUnit[0]),
    "a fixed width is what clipped kN·m - a select cannot grow past one",
  );

  check(
    "it sizes to its content instead",
    popupUnit && /width:\s*auto/.test(popupUnit[0]),
  );

  check(
    "and it reserves room for the caret beside the text",
    popupUnit && /padding:\s*0 16px 0 6px/.test(popupUnit[0]),
    "the caret must not sit on top of the unit",
  );

  /* The panel's unit selects. */
  const panelRule = css.match(
    /select\[data-property="loadUnit"\][\s\S]{0,300}?\{[^}]*\}/,
  );

  check(
    "a panel unit select has a floor wide enough for kN·m",
    panelRule && /min-width:\s*58px/.test(panelRule[0]),
    "min-width: 0 let a unit be squeezed below its own symbol",
  );
}

/* ============================================================
 * THE FIXED SUPPORT
 * ============================================================ */

console.log("\n  a fixed support is a wall at the END of the member\n");

{
  const F = state.geometryFactories;

  /* A horizontal beam, 100 long, at y = 0. */
  const beam = F.beam({ x: 0, y: 0 }, { x: 100, y: 0 });

  const frame = frames.frameOf(beam);

  check(
    "the beam has a frame to attach against",
    Boolean(frame),
  );

  /* The left end of the beam. */
  const end = { x: 0, y: 0 };

  const fixed = frames.supportPlacement(beam, end, false, { fixed: true });

  const ordinary = frames.supportPlacement(beam, end, false);

  check(
    "a FIXED support's wall sits ON the member's FACE, at the end",
    fixed &&
      Math.abs(fixed.render.x - end.x) < 1e-6 &&
      Math.abs(Math.abs(fixed.render.y) - frame.halfDepth) < 1e-6,
    JSON.stringify(fixed?.render) + " halfDepth=" + frame.halfDepth,
  );

  check(
    "while an ordinary support is stood off the face",
    ordinary && Math.abs(ordinary.render.y) > 0,
    JSON.stringify(ordinary?.render),
  );

  check(
    "and the fixed one is closer to the member than the ordinary one",
    fixed &&
      ordinary &&
      Math.hypot(fixed.render.x - end.x, fixed.render.y - end.y) <
        Math.hypot(ordinary.render.x - end.x, ordinary.render.y - end.y),
    `${JSON.stringify(fixed?.render)} vs ${JSON.stringify(ordinary?.render)}`,
  );

  /*
   * THE SIDE. `out` for the symbol is the direction its ground faces, which is
   * away from the body - so a positive `out` component is BEHIND the wall from
   * the body's point of view, which is where the hatching must be.
   */
  check(
    "and the symbol is told which side of the body it is on",
    fixed && (fixed.side === 1 || fixed.side === -1),
    `side ${fixed?.side}`,
  );
}

console.log("\n  and the RENDERER draws the hatch behind the wall\n");

{
  const source = require("fs").readFileSync(
    modulePath("renderer.js"),
    "utf8",
  );

  check(
    "the wall line is drawn ACROSS the member, at the anchor",
    /at\(0, -wall\)[\s\S]{0,200}at\(0, wall\)/.test(source),
    "the wall must cross the member, not lie along it",
  );

  check(
    "and every hatch stroke runs AWAY from the body, not across it",
    /at\(0, offset\)[\s\S]{0,120}at\(9, offset \+ 5\)/.test(source),
    "a stroke starting off the wall would cross the wall instead of standing behind it",
  );

  check(
    "the renderer tells the placement it is a fixed support",
    /supportPlacement\(/.test(source) &&
      /fixed: entity\.type === "fixed-support"/.test(source),
  );
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (fail) {
  process.exitCode = 1;
}
