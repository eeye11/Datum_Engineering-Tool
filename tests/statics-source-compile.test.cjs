/* eslint-disable no-console */
/*
 * ========================================================
 * STATICS SOURCE - COMPILED BY THE APPLICATION'S OWN ENGINE
 * ========================================================
 *
 * The suite next door checks the SHAPE of the generated code. This one checks
 * that TeX READS it: every source-backed Statics type is drawn, wrapped in a
 * picture, and compiled through the renderer the Source tab itself uses
 * (server/tikz.js, TikZJax). The standalone document the export produces is
 * compiled the same way.
 *
 * WHY IT IS WORTH THE SECONDS. A string that "looks like TikZ" can still name
 * a colour that was never defined, use an option this xcolor does not have,
 * or put a key where a colour belongs - and every one of those fails only when
 * a student draws the object. Compilation is the only check that answers
 * "does the code I am showing draw the thing?".
 *
 * The asynchronous case is written as a plain node:test suite because the
 * compile is a promise.
 */

const path = require("path");
const { test, before } = require("node:test");
const assert = require("node:assert/strict");

const projectRoot = path.join(__dirname, "..");

const STYLE = {
  stroke: "#193335",
  lineWidth: 0.75,
  lineType: "solid",
  fill: "none",
};

/* One object of every source-backed type, with REAL geometry. */
const OBJECTS = [
  [
    "particle",
    {
      id: "p1",
      type: "particle",
      name: "Particle 1",
      geometry: { position: { x: 10, y: 10 } },
    },
  ],
  [
    "rigid-body",
    {
      id: "rb1",
      type: "rigid-body",
      name: "Rigid Body 1",
      geometry: {
        position: { x: 20, y: 20 },
        width: 30,
        height: 15,
        rotation: 0,
      },
    },
  ],
  [
    "beam",
    {
      id: "b1",
      type: "beam",
      name: "Beam 1",
      geometry: { start: { x: 0, y: 0 }, end: { x: 120, y: 0 } },
    },
  ],
  [
    "truss",
    {
      id: "t1",
      type: "truss",
      name: "Truss 1",
      geometry: { start: { x: 0, y: 40 }, end: { x: 120, y: 40 }, panels: 4 },
    },
  ],
  [
    "cable",
    {
      id: "c1",
      type: "cable",
      name: "Cable 1",
      geometry: { start: { x: 0, y: 70 }, end: { x: 120, y: 70 }, sag: 10 },
    },
  ],
  [
    "shaft",
    {
      id: "s1",
      type: "shaft",
      name: "Shaft 1",
      geometry: {
        start: { x: 0, y: 90 },
        end: { x: 120, y: 90 },
        diameter: 12,
      },
    },
  ],
  [
    "force",
    {
      id: "f1",
      type: "force",
      name: "F1",
      geometry: { start: { x: 20, y: 0 }, magnitude: 40, angle: 90 },
    },
  ],
  [
    "load",
    {
      id: "q1",
      type: "load",
      name: "q1",
      geometry: {
        start: { x: 0, y: 0 },
        end: { x: 120, y: 0 },
        intensity: 5,
        direction: -90,
        interval: 20,
        loadUnit: "kN/m",
        points: [
          { t: 0, magnitude: 5 },
          { t: 1, magnitude: 5 },
        ],
        normalSide: 1,
      },
    },
  ],
  [
    "varying-load",
    {
      id: "q2",
      type: "varying-load",
      name: "q1(x)",
      geometry: {
        start: { x: 0, y: 0 },
        end: { x: 120, y: 0 },
        startIntensity: 2,
        endIntensity: 8,
        direction: -90,
        interval: 20,
        loadUnit: "kN/m",
        points: [
          { t: 0, magnitude: 2 },
          { t: 1, magnitude: 8 },
        ],
        normalSide: 1,
      },
    },
  ],
  [
    "moment",
    {
      id: "m1",
      type: "moment",
      name: "M1",
      geometry: {
        position: { x: 60, y: 0 },
        magnitude: 10,
        direction: "CCW",
        unit: "N\\cdot m",
      },
    },
  ],
  [
    "pin-support",
    {
      id: "su1",
      type: "pin-support",
      name: "Pin",
      geometry: {
        position: { x: 0, y: 0 },
        orientation: -1.5708,
        flipped: false,
      },
    },
  ],
  [
    "roller-support",
    {
      id: "su2",
      type: "roller-support",
      name: "Roller",
      geometry: {
        position: { x: 120, y: 0 },
        orientation: -1.5708,
        flipped: false,
      },
    },
  ],
  [
    "fixed-support",
    {
      id: "su3",
      type: "fixed-support",
      name: "Fixed",
      geometry: { position: { x: 0, y: 0 }, orientation: 0, flipped: false },
    },
  ],
  [
    "smooth-support",
    {
      id: "su4",
      type: "smooth-support",
      name: "Smooth",
      geometry: {
        position: { x: 10, y: 0 },
        orientation: -1.5708,
        flipped: false,
      },
    },
  ],
  [
    "pin-connection",
    {
      id: "j1",
      type: "pin-connection",
      name: "J1",
      geometry: { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
    },
  ],
  [
    "fixed-connection",
    {
      id: "j2",
      type: "fixed-connection",
      name: "J2",
      geometry: { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
    },
  ],
  [
    "slider-connection",
    {
      id: "j3",
      type: "slider-connection",
      name: "J3",
      geometry: { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
    },
  ],
  [
    "resultant",
    {
      id: "r1",
      type: "resultant",
      name: "R",
      geometry: {
        start: { x: 0, y: 0 },
        end: { x: 30, y: 40 },
        magnitude: 50,
        angle: 53.13,
        forceX: 30,
        forceY: 40,
      },
    },
  ],
  [
    "force-components",
    {
      id: "fc1",
      type: "force-components",
      name: "Components",
      geometry: {
        position: { x: 0, y: 0 },
        start: { x: 0, y: 0 },
        end: { x: 30, y: 40 },
        horizontal: { start: { x: 0, y: 0 }, end: { x: 30, y: 0 } },
        vertical: { start: { x: 0, y: 0 }, end: { x: 0, y: 40 } },
        forceX: 30,
        forceY: 40,
      },
    },
  ],
  [
    "analysis-diagram",
    {
      id: "sfd1",
      type: "analysis-diagram",
      name: "SFD 1",
      geometry: {
        start: { x: 0, y: -150 },
        end: { x: 120, y: -150 },
        diagramType: "sfd",
        mode: "plot",
        localRange: { from: 0, to: 5 },
        expressions: [
          {
            id: "e1",
            relationType: "functionX",
            visible: true,
            expression: "10 - 2x",
            xRange: { start: 0, end: 5 },
          },
          {
            id: "e2",
            relationType: "verticalLine",
            visible: true,
            x: 5,
            yRange: { start: 0, end: -5 },
          },
        ],
        showValues: true,
        results: [{ x: 2, value: 6 }],
      },
    },
  ],
  [
    "coordinate-system-2d",
    {
      id: "cs1",
      type: "coordinate-system-2d",
      name: "Axes",
      geometry: {
        origin: { x: -120, y: 0 },
        xPositiveLength: 20,
        xNegativeLength: 20,
        yPositiveLength: 20,
        yNegativeLength: 20,
        xLabel: "x",
        yLabel: "y",
        originLabel: "O",
      },
    },
  ],
  [
    "point",
    {
      id: "ref1",
      type: "point",
      name: "P1",
      geometry: { position: { x: -100, y: 40 } },
    },
  ],
  [
    "line",
    {
      id: "ref2",
      type: "line",
      name: "L1",
      geometry: { start: { x: -100, y: 30 }, end: { x: -60, y: 30 } },
      style: { ...STYLE, lineType: "construction" },
    },
  ],
  [
    "arc",
    {
      id: "ref3",
      type: "arc",
      name: "Arc1",
      geometry: {
        center: { x: -80, y: 0 },
        radius: 10,
        startAngle: 0,
        endAngle: 90,
      },
    },
  ],
].map(([type, object]) => ({
  type,
  object: { ...object, style: object.style || STYLE },
}));

let tikz = null;
let statics = null;

before(async () => {
  /*
   * The engine is imported as an ES module, because that is what it is. The
   * TikZ core takes a few seconds to load once; every compile after it is
   * queued through the same service the application uses.
   */
  tikz = await import("../server/tikz.js");
  statics =
    await import("../src/shared/rendering/latex/source-writers/statics.js");

  await tikz.loadTikz();
});

for (const { type, object } of OBJECTS) {
  test(`${type} source compiles with the application's TikZ engine`, async () => {
    const source = statics.serializeStaticsObject(object);

    assert.ok(source, `${type} produced no source`);

    const svg = await tikz.renderTikz(
      `\\begin{tikzpicture}\n${source}\n\\end{tikzpicture}`,
    );

    assert.ok(svg && svg.includes("<svg"), `${type} compiled to no drawing`);
  });
}

test("a whole Statics sheet compiles, and its standalone document with it", async () => {
  const picture = `\\begin{tikzpicture}[x=1mm, y=1mm]\n${statics.generateStaticsTikz(OBJECTS.map((entry) => entry.object))}\n\\end{tikzpicture}`;

  const svg = await tikz.renderTikz(picture);
  assert.ok(svg && svg.includes("<svg"), "the sheet compiled to no drawing");

  const standalone = statics.wrapAsStandaloneTex(picture);
  const standaloneSvg = await tikz.renderTikz(standalone);

  assert.ok(
    standaloneSvg && standaloneSvg.includes("<svg"),
    "the standalone document compiled to no drawing",
  );
});
