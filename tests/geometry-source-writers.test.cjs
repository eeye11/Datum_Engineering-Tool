/* eslint-disable no-console */
/*
 * ========================================================
 * GEOMETRY SOURCE WRITERS - ALL NINE TOOLS
 * ========================================================
 *
 * The Source tab is only worth having if the code it shows is the code that
 * draws the picture. These tests drive the real `geometrySourceWriter` with
 * objects of every Geometry type and check that:
 *
 *   1. The TikZ carries the COMMITTED coordinates, not a placeholder.
 *   2. Appearance chosen in Features reaches the source (thickness, dash,
 *      colour, fill, marker style/size, arrow heads, labels).
 *   3. The geometry rules survive writing: an arc keeps its radius and sweep,
 *      a polygon's vertices are the regular polygon, a coordinate system's
 *      axes stay perpendicular, a freeform polygon keeps its own order.
 *   4. A half-built object writes nothing rather than a degenerate command.
 *
 * The writer is pure - it takes an object and returns a string - so it is
 * exercised directly, without a canvas, exactly as the test suite loads every
 * other model module.
 */

const path = require("path");
const { JSDOM } = require("jsdom");

const projectRoot = path.join(__dirname, "..");

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

const { createHarness } = require("./harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

const { modulePath, loadModule } = require("./helpers/source-path.cjs");

const geometry = loadModule("geometry.js");
const write = geometry.geometrySourceWriter;

/* ============================================================ helpers */

function objectOf(type, geometryData, style = {}, extra = {}) {
  return {
    id: `${type}-test`,
    type,
    geometry: geometryData,
    style: { stroke: "#000000", lineWidth: 0.75, lineType: "solid", ...style },
    ...extra,
  };
}

const has = (text, fragment) => typeof text === "string" && text.includes(fragment);

/* ============================================================== Point */

console.log("\nPoint");
console.log("-----");

const dot = write(objectOf("point", { position: { x: 30, y: 40 } }, { markerStyle: "dot", markerSize: "medium" }));

check("a point writes a filled marker at its committed position", has(dot, "(30,40) circle[radius="), dot);
check("and a named coordinate so later commands can refer to it", has(dot, "\\coordinate (pointtest) at (30,40);"), dot);

const cross = write(objectOf("point", { position: { x: 12, y: -8 } }, { markerStyle: "cross", markerSize: "large" }));

check("a cross point writes two perpendicular strokes", (cross.match(/\\draw/g) || []).length === 2, cross);
check("and the cross is centred on the point", has(cross, "(12,-8)") || has(cross, "12,-8"), cross);

const smallDot = write(objectOf("point", { position: { x: 0, y: 0 } }, { markerSize: "small" }));
const largeDot = write(objectOf("point", { position: { x: 0, y: 0 } }, { markerSize: "large" }));

const radiusOf = (text) => Number((text.match(/radius=([\d.]+)/) || [])[1]);

check("the Large marker is drawn larger than the Small one", radiusOf(largeDot) > radiusOf(smallDot), `${radiusOf(largeDot)} vs ${radiusOf(smallDot)}`);

/* =============================================================== Line */

console.log("\nLine");
console.log("----");

const line = write(objectOf("line", { start: { x: 0, y: 0 }, end: { x: 30, y: 10 } }, { lineType: "solid", lineWidth: 0.75 }));

check("a line runs between its two committed endpoints", has(line, "(0,0) -- (30,10)"), line);

const dashedLine = write(objectOf("line", { start: { x: 0, y: 0 }, end: { x: 30, y: 0 } }, { lineType: "dashed" }));
const dottedLine = write(objectOf("line", { start: { x: 0, y: 0 }, end: { x: 30, y: 0 } }, { lineType: "dotted" }));

check("a dashed line writes the dashed option", has(dashedLine, "dashed"), dashedLine);
check("a dotted line writes the dotted option", has(dottedLine, "dotted"), dottedLine);
check("a solid line writes neither", !has(line, "dashed") && !has(line, "dotted"), line);

const thin = write(objectOf("line", { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, { lineWidth: "thin" }));
const thick = write(objectOf("line", { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, { lineWidth: "thick" }));

const widthOf = (text) => Number((text.match(/line width=([\d.]+)pt/) || [])[1]);

check("a named thickness is written as a pen width", Number.isFinite(widthOf(thin)), thin);
check("and Thick is wider than Thin", widthOf(thick) > widthOf(thin), `${widthOf(thick)} vs ${widthOf(thin)}`);

const arrowed = write(objectOf("line", { start: { x: 0, y: 0 }, end: { x: 20, y: 0 } }, { arrowStart: "bar", arrowEnd: "filled" }));

check("independent begin and end arrow heads are written", has(arrowed, "|") && has(arrowed, "Latex"), arrowed);
check("and an arrowhead does not move an endpoint", has(arrowed, "(0,0) -- (20,0)"), arrowed);

/* =========================================================== Triangle */

console.log("\nTriangle");
console.log("--------");

const triangle = write(
  objectOf("triangle", {
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 10, y: 30 },
    ],
  })
);

check("a triangle is a closed path through its three committed vertices", has(triangle, "(0,0)") && has(triangle, "(40,0)") && has(triangle, "(10,30)") && has(triangle, "-- cycle"), triangle);

const filledTriangle = write(
  objectOf(
    "triangle",
    {
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 10, y: 30 },
      ],
    },
    { fillMode: "solid", fill: "#ff0000" }
  )
);

check("a Solid fill writes a fill colour", has(filledTriangle, "fill=daetumCFF0000"), filledTriangle);
check("and the fill colour is defined before it is used", filledTriangle.indexOf("\\definecolor") < filledTriangle.indexOf("\\draw"), filledTriangle);
check("while Fill None leaves it an outline", !has(triangle, "fill=daetum") && !has(triangle, "fill=red"), triangle);

check("a triangle with only two vertices writes nothing", write(objectOf("triangle", { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })) === null);

/* ========================================================== Rectangle */

console.log("\nRectangle");
console.log("---------");

const rectangle = write(objectOf("rectangle", { position: { x: 10, y: 50 }, width: 30, height: 20, rotation: 0 }));

/*
 * `position` is the TOP-LEFT corner and y grows upward, so the rectangle runs
 * down from it - the canvas draws it there. (This used to expect it written
 * upward, one height above where it is drawn.)
 */
check("a rectangle uses its two committed opposite corners", has(rectangle, "(10,30) rectangle (40,50)"), rectangle);

const rotated = write(objectOf("rectangle", { position: { x: 0, y: 0 }, width: 10, height: 10, rotation: 45 }));

check("a rotated rectangle becomes a closed four-corner path", has(rotated, "-- cycle") && (rotated.match(/\(/g) || []).length >= 4, rotated);

/* ============================================================= Circle */

console.log("\nCircle");
console.log("------");

const circle = write(objectOf("circle", { center: { x: 20, y: 20 }, radius: 15 }));

check("a circle writes its centre and computed radius", has(circle, "(20,20) circle[radius=15]"), circle);

check("a zero-radius circle writes nothing", write(objectOf("circle", { center: { x: 0, y: 0 }, radius: 0 })) === null);

const filledCircle = write(objectOf("circle", { center: { x: 0, y: 0 }, radius: 5 }, { fillMode: "solid", fill: "#00ff00" }));

check("a Solid circle writes its fill", has(filledCircle, "fill=daetumC00FF00"), filledCircle);

/* ================================================================ Arc */

console.log("\nArc");
console.log("---");

/* An arc's angles are stored in RADIANS (as the canvas draws them) and written in degrees. */
const arc = write(objectOf("arc", { center: { x: 0, y: 0 }, radius: 10, startAngle: 0, endAngle: Math.PI / 2 }));

check("an arc writes its committed radius and sweep", has(arc, "radius=10") && has(arc, "start angle=0") && has(arc, "end angle=90"), arc);
check("and starts at the point on its own circle", has(arc, "(10,0)"), arc);

/* An arc that crosses the 0/360 seam keeps its unwrapped end angle. */
const seamArc = write(objectOf("arc", { center: { x: 0, y: 0 }, radius: 10, startAngle: (350 * Math.PI) / 180, endAngle: (370 * Math.PI) / 180 }));

check("an arc across the 0-degree seam keeps its unwrapped angles", has(seamArc, "start angle=350") && has(seamArc, "end angle=370"), seamArc);

check("a degenerate arc writes nothing", write(objectOf("arc", { center: { x: 0, y: 0 }, radius: 10, startAngle: 0.7, endAngle: 0.7 })) === null);

/* ============================================================= Polygon */

console.log("\nPolygon");
console.log("-------");

const hexagon = write(objectOf("polygon", { center: { x: 0, y: 0 }, radius: 10, sides: 6, rotation: 0 }));

check("a regular polygon is closed through its derived vertices", has(hexagon, "-- cycle"), hexagon);
check("and the first vertex sits on the circumcircle", has(hexagon, "(10,0)"), hexagon);

const pentagon = write(objectOf("polygon", { center: { x: 0, y: 0 }, radius: 10, sides: 5, rotation: 0 }));

const vertexCount = (text) => (text.match(/\(-?[\d.]+,-?[\d.]+\)/g) || []).length;

check("changing the side count changes the vertex count", vertexCount(pentagon) === 5 && vertexCount(hexagon) === 6, `pentagon ${vertexCount(pentagon)}, hexagon ${vertexCount(hexagon)}`);

/* ==================================================== Freeform Polygon */

console.log("\nFreeform Polygon");
console.log("----------------");

const freeform = write(
  objectOf("freeform-polygon", {
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 4 },
      { x: 22, y: 25 },
      { x: 4, y: 18 },
    ],
  })
);

check("a freeform polygon uses every committed vertex in order", has(freeform, "(0,0)") && has(freeform, "(30,4)") && has(freeform, "(22,25)") && has(freeform, "(4,18)"), freeform);
check("and closes back to the first", has(freeform, "-- cycle"), freeform);

const inOrder = ["(0,0)", "(30,4)", "(22,25)", "(4,18)"]
  .map((token) => freeform.indexOf(token))
  .every((index, at, all) => index >= 0 && (at === 0 || index > all[at - 1]));

check("the vertices keep the order they were drawn in", inOrder, freeform);

check("a freeform polygon with two vertices writes nothing", write(objectOf("freeform-polygon", { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })) === null);

/* ==================================================== Coordinate System */

console.log("\nCoordinate System");
console.log("-----------------");

const coordinateSystem = write(
  objectOf(
    "coordinate-system-2d",
    {
      origin: { x: 50, y: 50 },
      xPositiveLength: 20,
      xNegativeLength: 20,
      yPositiveLength: 20,
      yNegativeLength: 20,
      xLabel: "x",
      yLabel: "y",
      originLabel: "O",
    },
    { stroke: "#000000", lineWidth: 0.75 }
  )
);

check("a coordinate system writes both axes", (coordinateSystem.match(/--/g) || []).length === 2, coordinateSystem);
check("through its committed origin", has(coordinateSystem, "(30,50) -- (70,50)") && has(coordinateSystem, "(50,30) -- (50,70)"), coordinateSystem);
check(
  "and the axes are exactly perpendicular",
  has(coordinateSystem, "(30,50) -- (70,50)") && has(coordinateSystem, "(50,30) -- (50,70)"),
  "an X arm of constant y and a Y arm of constant x are perpendicular by construction"
);
check("with the axis labels written as nodes", has(coordinateSystem, "{x}") && has(coordinateSystem, "{y}") && has(coordinateSystem, "{O}"), coordinateSystem);

/*
 * A system placed by a drag stores the angle its X arm points in. The code has
 * to describe the same turned cross the canvas draws - and the Y arm has to
 * stay square to the X arm, because both are turned by the same angle. A
 * rotation of 90 degrees is the clearest check: the X arm becomes vertical and
 * the Y arm becomes horizontal, exactly swapping places with the unrotated
 * system's arms.
 */
const turned = write(
  objectOf("coordinate-system-2d", {
    origin: { x: 0, y: 0 },
    rotation: Math.PI / 2,
    xPositiveLength: 20,
    xNegativeLength: 20,
    yPositiveLength: 20,
    yNegativeLength: 20,
    xLabel: "x",
    yLabel: "y",
    originLabel: "O",
  })
);

check(
  "a rotated coordinate system turns its X arm into the Y direction",
  has(turned, "(0,-20) -- (0,20)"),
  turned
);

check(
  "and its Y arm into the X direction, staying square to it",
  has(turned, "(20,0) -- (-20,0)"),
  turned
);

const noLabels = write(
  objectOf("coordinate-system-2d", {
    origin: { x: 0, y: 0 },
    xPositiveLength: 20,
    xNegativeLength: 20,
    yPositiveLength: 20,
    yNegativeLength: 20,
    showLabels: false,
  })
);

check("hiding the labels omits them from the source", !has(noLabels, "\\node"), noLabels);

const xOnly = write(
  objectOf("coordinate-system-2d", {
    origin: { x: 0, y: 0 },
    xPositiveLength: 20,
    xNegativeLength: 20,
    yPositiveLength: 20,
    yNegativeLength: 20,
    showYAxis: false,
  })
);

check("hiding the Y axis leaves only the X axis", (xOnly.match(/--/g) || []).length === 1, xOnly);

/* ============================================ unsupported / half-built */

console.log("\nWhat must NOT be written");
console.log("------------------------");

check("an unknown type writes nothing", write(objectOf("not-a-shape", {})) === null);
check("a missing object writes nothing", write(null) === null);
check("a line with no geometry writes a path at the origin rather than throwing", typeof write(objectOf("line", {})) === "string");

/*
 * Each type is given geometry appropriate to it, because a type with no valid
 * geometry is SUPPOSED to write nothing - that is checked above. This asserts
 * that every type the Features spec names is known to the writer; what each
 * one's source contains is checked in its own section.
 */
const wellFormed = {
  point: { position: { x: 1, y: 1 } },
  line: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  triangle: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }] },
  rectangle: { position: { x: 0, y: 0 }, width: 1, height: 1, rotation: 0 },
  circle: { center: { x: 0, y: 0 }, radius: 1 },
  arc: { center: { x: 0, y: 0 }, radius: 1, startAngle: 0, endAngle: 90 },
  polygon: { center: { x: 0, y: 0 }, radius: 1, sides: 3, rotation: 0 },
  "freeform-polygon": { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }] },
  "coordinate-system-2d": {
    origin: { x: 0, y: 0 },
    xPositiveLength: 10,
    xNegativeLength: 10,
    yPositiveLength: 10,
    yNegativeLength: 10,
  },
};

check(
  "the writer knows every Geometry type the Features spec names",
  Object.keys(wellFormed).every(
    (type) => typeof write(objectOf(type, wellFormed[type])) === "string",
  ),
);

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
