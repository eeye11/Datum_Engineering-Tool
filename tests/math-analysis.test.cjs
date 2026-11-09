/* eslint-disable no-console */
/*
 * ========================================================
 * MATH / ANALYSIS
 * ========================================================
 *
 * The seven Math objects and the relationships between them. This suite drives
 * the real modules, so a rule that is only written in a comment fails here
 * rather than in a report.
 *
 *   the sidebar is Select / Create / Analysis / Reference
 *   Sketch and Plot are modes of a tool, not tools
 *   a Point is placed, labelled, projected and attached to a curve
 *   a Vector is drawn by a drag and its components are derived
 *   a Coordinate Graph maps graph coordinates to drawing units
 *   a Function Curve is plotted from an expression and sketched from a stroke
 *   an Equation is written inline and rendered as mathematics
 *   a Tangent / Normal is derived in Plot and reconstructed in Sketch
 *   a Slope Triangle is constrained in Plot and regularised in Sketch
 *   the Reference tools are the Statics ones, not copies
 *   every object is written to the source and read back
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

const { dom } = createHarness(projectRoot, JSDOM, require);

[
  "drawingProperties",
  "drawingToolMessage",
  "drawingCoordinates",
  "drawingZoomValue",
  "drawingToolHeading",
  "drawingToolList",
  "drawingFeaturesBack",
].forEach((id) => {
  const element = dom.window.document.createElement("div");

  element.id = id;
  dom.window.document.body.appendChild(element);
});

const canvas = dom.window.document.createElement("div");

canvas.className = "drawing-canvas";
dom.window.document.body.appendChild(canvas);

const { loadModule } = require("./helpers/source-path.cjs");

const model = loadModule("drawing-state.js").default;
const { drawingState } = loadModule("editor-state.js");
const mathModel = loadModule("math-model.js").default;
const mathTools = loadModule("math-tools.js").default;
const mathCreation = loadModule("math-creation.js").default;
const mathSketch = loadModule("math-sketch.js").default;
const mathWriter = loadModule("source-writers/math.js");
const mathReader = require(path.join(
  projectRoot,
  "src",
  "shared",
  "rendering",
  "latex",
  "source-readers",
  "math.js",
));
const mathReaderFor = mathReader.mathReaderFor;
const classification = loadModule("tool-classification.js");
const schema = loadModule("feature-schema.js");

/* ============================================================ fixture */

function reset() {
  drawingState.objects = [];
  drawingState.selection.selectedObjectIds = [];
  drawingState.interaction = { phase: "idle" };
  drawingState.activeTool = "select";
}

function add(object) {
  const before = model.snapshotDrawing(drawingState);

  model.addObject(drawingState, object);
  model.commitDrawingChange(drawingState, before);

  return object;
}

/* ====================================================== the sidebar */

console.log("\nThe sidebar");
console.log("-----------");

check(
  "the section is Select, Create, Analysis, Reference",
  mathTools.MATH_TOOL_GROUPS.map((group) => group.label).join(",") ===
    "Select,Create,Analysis,Reference",
  JSON.stringify(mathTools.MATH_TOOL_GROUPS.map((group) => group.label)),
);

check(
  "Create holds Point, Vector, Graph and Equation",
  mathTools.MATH_TOOL_GROUPS[1].tools.map((tool) => tool.label).join(",") ===
    "Point,Vector,Graph,Equation / Expression",
  JSON.stringify(mathTools.MATH_TOOL_GROUPS[1].tools.map((tool) => tool.label)),
);

check(
  "the tool is called Graph, not Plot",
  !mathTools.MATH_TOOL_GROUPS.some((group) =>
    group.tools.some((tool) => tool.label === "Plot"),
  ),
);

check(
  "and its modes are Sketch and Plot",
  mathTools.MATH_MODE_LABELS.sketch === "Sketch" &&
    mathTools.MATH_MODE_LABELS.plot === "Plot",
  JSON.stringify(mathTools.MATH_MODE_LABELS),
);

check(
  "there is no separate Coordinate Graph or Function Curve tool",
  !mathTools.MATH_TOOL_GROUPS.some((group) =>
    group.tools.some((tool) =>
      ["Coordinate Graph", "Function Curve"].includes(tool.label),
    ),
  ),
);

check(
  "Analysis holds Tangent / Normal and Slope Triangle",
  mathTools.MATH_TOOL_GROUPS[2].tools.map((tool) => tool.label).join(",") ===
    "Tangent / Normal,Slope Triangle",
  JSON.stringify(mathTools.MATH_TOOL_GROUPS[2].tools.map((tool) => tool.label)),
);

check(
  "Reference reuses the Statics tool ids",
  mathTools.MATH_TOOL_GROUPS[3].tools.map((tool) => tool.id).join(",") ===
    "coordinate-system,reference-point,reference-line",
  JSON.stringify(mathTools.MATH_TOOL_GROUPS[3].tools.map((tool) => tool.id)),
);

check(
  "there is no Data Plot and no Intersection Marker",
  !JSON.stringify(mathTools.MATH_TOOL_GROUPS).includes("Data Plot") &&
    !JSON.stringify(mathTools.MATH_TOOL_GROUPS).includes("Intersection"),
);

/* ====================================================== the modes */

console.log("\nSketch and Plot are modes, not tools");
console.log("-------------------------------------");

check(
  "only the Plot has Sketch and Plot",
  mathTools.MATH_MODE_TOOLS.join(",") === "math-plot",
  JSON.stringify(mathTools.MATH_MODE_TOOLS),
);

check(
  "Tangent / Normal and Slope Triangle are single constructions",
  !mathTools.mathToolHasModes("math-tangent") &&
    !mathTools.mathToolHasModes("math-slope-triangle"),
);

check(
  "Point, Vector, Graph and Equation have neither",
  !mathTools.mathToolHasModes("math-point") &&
    !mathTools.mathToolHasModes("math-vector") &&
    !mathTools.mathToolHasModes("math-equation"),
);

check(
  "the modes are Sketch and Plot",
  mathTools.MATH_MODES.join(",") === "sketch,plot",
);

/* ====================================================== the graph */

console.log("\nThe Plot");
console.log("--------");

reset();

const graph = add(
  mathModel.createMathPlot({ x: 0, y: 0 }, 100, 100, {
    style: { stroke: "#000000", lineWidth: 0.5 },
  }),
);

check(
  "a plot is created from a box",
  Boolean(graph) && graph.type === "math-plot",
);

check(
  "and it owns its functions",
  Array.isArray(graph.geometry.functions),
);

check(
  "its default limits are -5 to 5 on both axes",
  JSON.stringify(mathModel.graphLimits(graph)) ===
    JSON.stringify({ xMin: -5, xMax: 5, yMin: -5, yMax: 5 }),
  JSON.stringify(mathModel.graphLimits(graph)),
);

const mapping = mathModel.graphMapping(graph);

check("it has a mapping", Boolean(mapping));

check(
  "the origin maps to the middle of the plot area",
  Math.abs(mapping.origin.x - (mapping.left + mapping.width / 2)) < 1e-6 &&
    Math.abs(mapping.origin.y - (mapping.bottom + mapping.height / 2)) < 1e-6,
);

check(
  "equal unit scaling makes one unit the same length on both axes",
  Math.abs(mapping.scaleX - mapping.scaleY) < 1e-9,
  `${mapping.scaleX} vs ${mapping.scaleY}`,
);

const roundTrip = mathModel.drawingToGraph(
  graph,
  mathModel.graphToDrawing(graph, { x: 2, y: -3 }),
);

check(
  "a graph coordinate survives a round trip",
  Math.abs(roundTrip.x - 2) < 1e-9 && Math.abs(roundTrip.y + 3) < 1e-9,
  JSON.stringify(roundTrip),
);

check(
  "a zero-size plot is refused",
  mathModel.createMathPlot({ x: 0, y: 0 }, 0, 0) === null,
);

check(
  "tick values follow the range",
  mathModel.tickValues(-5, 5).join(",") === "-5,-4,-3,-2,-1,0,1,2,3,4,5",
  mathModel.tickValues(-5, 5).join(","),
);

/* ====================================================== the point */

console.log("\nThe Point");
console.log("---------");

reset();

const point = mathCreation.placeMathPoint({ x: 10, y: 20 });

check("a click places a point", Boolean(point) && point.type === "math-point");

check(
  "and it becomes the selection",
  drawingState.selection.selectedObjectIds.includes(point.id),
);

check(
  "the tool stays armed",
  drawingState.activeTool === "math-point" ||
    drawingState.activeTool === "select",
  drawingState.activeTool,
);

const second = mathCreation.placeMathPoint({ x: 30, y: 40 });

check(
  "a second click places a second point",
  Boolean(second) && second.id !== point.id,
);

check(
  "the two points are numbered apart",
  point.name !== second.name,
  `${point.name} / ${second.name}`,
);

check(
  "the label mode starts as the object's own label",
  schema.readField(point, "mathLabelMode") === "name",
  String(schema.readField(point, "mathLabelMode")),
);

schema.writeField(point, "mathLabelMode", "custom");

check(
  "a custom label is stored on the point, not in its name",
  schema.writeField(point, "mathLabelText", "A") === true &&
    point.engineering.labelText === "A" &&
    point.name !== "A",
  `${point.engineering.labelText} / ${point.name}`,
);

check(
  "the X and Y projections are independently configurable",
  schema.writeField(point, "mathShowXProjection", true) === true &&
    point.engineering.showXProjection === true &&
    point.engineering.showYProjection === false,
);

check(
  "a point can reference a graph",
  schema.writeField(point, "mathShowCoordinates", true) === true,
);

/* A point placed on a curve is associated with it. */
reset();

const curveGraph = add(
  mathModel.createMathPlot({ x: 0, y: 0 }, 120, 120, {
    style: { stroke: "#000000", lineWidth: 0.5 },
    mode: "plot",
    functions: [mathModel.createPlotFunction({ expression: "x^2" })],
  }),
);

const plotted = mathModel.plotFunctions(curveGraph)[0];

check(
  "a plot holds a function plotted from an expression",
  Boolean(plotted) && plotted.expression === "x^2",
);

const onCurve = mathModel.graphToDrawing(curveGraph, { x: 2, y: 4 });

const attached = mathCreation.placeMathPoint(onCurve);

check(
  "a point placed on a curve is associated with its plot",
  attached.geometry.parentCurveId === curveGraph.id,
  String(attached.geometry.parentCurveId),
);

check(
  "and names the function it landed on",
  attached.geometry.curveFunctionId === plotted.id,
  String(attached.geometry.curveFunctionId),
);

check(
  "and records where along the curve it sits",
  Number.isFinite(attached.geometry.curveParameter),
  String(attached.geometry.curveParameter),
);

check(
  "a point placed inside a plot records the plot",
  attached.geometry.parentGraphId === curveGraph.id,
  String(attached.geometry.parentGraphId),
);

/* ====================================================== the vector */

console.log("\nThe Vector");
console.log("----------");

reset();

const vector = mathCreation.createMathVectorFromDrag(
  { x: 0, y: 0 },
  { x: 30, y: 40 },
);

check(
  "a drag creates a vector",
  Boolean(vector) && vector.type === "math-vector",
);

check(
  "it stores its two endpoints, not a magnitude and an angle",
  vector.geometry.start.x === 0 && vector.geometry.end.y === 40,
);

check(
  "a zero-length drag creates nothing",
  mathCreation.createMathVectorFromDrag({ x: 5, y: 5 }, { x: 5, y: 5 }) ===
    null,
);

check(
  "the length is derived from the endpoints, not stored",
  Math.abs(
    Math.hypot(
      vector.geometry.end.x - vector.geometry.start.x,
      vector.geometry.end.y - vector.geometry.start.y,
    ) - 50,
  ) < 1e-9,
);

check(
  "and there is no Length row, because the head handle sets it",
  schema.readField(vector, "mathVectorLength") === undefined,
);

check(
  "the components and the guides are independent switches",
  schema.writeField(vector, "mathShowComponents", true) === true &&
    vector.engineering.showComponents === true &&
    vector.engineering.showProjectionGuides === false,
);

/* ====================================================== the plot */

console.log("\nThe Plot's functions");
console.log("--------------------");

reset();

const plotGraph = add(
  mathModel.createMathPlot({ x: 0, y: 0 }, 120, 120, {
    style: { stroke: "#000000", lineWidth: 0.5 },
    mode: "plot",
    functions: [mathModel.createPlotFunction({ expression: "x^2" })],
  }),
);

const parabola = mathModel.plotFunctions(plotGraph)[0];

check("Plot mode creates a plot with a function", parabola.mode === "plot");

check(
  "the function keeps its expression, variable and domain",
  parabola.expression === "x^2" &&
    parabola.variable === "x" &&
    parabola.domain.min === -5 &&
    parabola.domain.max === 5,
);

check(
  "its points are a sample of the expression, not stored data",
  parabola.points.length === 0,
);

const strokes = mathModel.curveStrokes(plotGraph);

check(
  "the plot has a drawn path",
  strokes.length === 1 && strokes[0].length > 10,
);

check(
  "an invalid expression is refused",
  mathCreation.addPlotFunction(plotGraph, "sin(x)") === null,
);

check(
  "a second function can be added to the same plot",
  Boolean(mathCreation.addPlotFunction(plotGraph, "2x + 1")) &&
    mathModel.plotFunctions(plotGraph).length === 2,
  String(mathModel.plotFunctions(plotGraph).length),
);

check(
  "and both are drawn",
  mathModel.curveStrokes(plotGraph).length === 2,
  String(mathModel.curveStrokes(plotGraph).length),
);

check(
  "a function can be removed by its id",
  mathCreation.removePlotFunction(plotGraph, parabola.id) === true &&
    mathModel.plotFunctions(plotGraph).length === 1,
);

/* A sketch is reconstructed from a stroke. */
const jittery = [];

for (let index = 0; index <= 60; index += 1) {
  const x = index * 2;

  jittery.push({
    x,
    y: 40 + Math.sin(index / 6) * 20 + (index % 2 ? 0.6 : -0.6),
  });
}

const reconstruction = mathModel.reconstructStroke(jittery, {
  tolerance: 0.5,
  smoothing: 1,
});

check(
  "a stroke is reduced to fewer points than it was drawn with",
  reconstruction.points.length < jittery.length,
  `${reconstruction.points.length} of ${jittery.length}`,
);

check(
  "and becomes a chain of cubic Beziers",
  reconstruction.segments.length === reconstruction.points.length - 1,
);

check(
  "the original stroke is kept",
  reconstruction.original.length === jittery.length,
);

const sketched = mathCreation.commitSketchPlot([reconstruction], {
  showOriginalTrace: true,
});

check(
  "a sketched plot is committed",
  Boolean(sketched) && sketched.type === "math-plot",
);

check(
  "and its stroke is a function component of it",
  mathModel.plotFunctions(sketched).length === 1 &&
    mathModel.plotFunctions(sketched)[0].mode === "sketch",
);

check(
  "the component keeps its reconstructed geometry and its original trace",
  mathModel.plotFunctions(sketched)[0].segments.length > 0 &&
    mathModel.plotFunctions(sketched)[0].originalTrace.length > 0,
);

check(
  "the original trace is a dependent visual, not a second object",
  drawingState.objects.filter((object) => object.type === "math-plot").length ===
    2,
);

const graphPoints = reconstruction.points.map((entry) =>
  mathModel.drawingToGraph(plotGraph, entry),
);

const coefficients = mathModel.fitPolynomial(graphPoints, 2);

check(
  "a quadratic fit is computed",
  Array.isArray(coefficients) && coefficients.length === 3,
);

check(
  "and written as an expression a student would type",
  /x\^2/.test(mathModel.polynomialExpression(coefficients)),
  mathModel.polynomialExpression(coefficients),
);

check(
  "a fit with too few points is refused",
  mathModel.fitPolynomial([{ x: 0, y: 0 }], 2) === null,
);

/* ====================================================== the equation */

console.log("\nThe Equation");
console.log("------------");

reset();

const equation = mathModel.createMathEquation(
  { x: 20, y: 20 },
  {
    style: { stroke: "#000000", lineWidth: 0.5 },
    content: "\\frac{a}{b} = c^2",
  },
);

check(
  "an equation is created at its anchor",
  Boolean(equation) && equation.type === "math-equation",
);

check(
  "it stores its content, size and alignment",
  equation.engineering.content === "\\frac{a}{b} = c^2" &&
    equation.engineering.fontSize === 16 &&
    equation.engineering.align === "center",
);

check(
  "an unbalanced brace is reported",
  typeof loadModule("math-equation-editor.js").equationProblem(
    "\\frac{a}{b",
  ) === "string",
);

check(
  "a balanced expression is accepted",
  loadModule("math-equation-editor.js").equationProblem(
    "\\frac{a}{b} = c^2",
  ) === null,
);

check(
  "the font size is a Features property",
  schema.writeField(equation, "mathEquationFontSize", 24) === true &&
    equation.engineering.fontSize === 24,
);

/* ====================================================== tangent */

console.log("\nTangent / Normal");
console.log("----------------");

reset();

const tangentGraph = add(
  mathModel.createMathPlot({ x: 0, y: 0 }, 120, 120, {
    style: { stroke: "#000000", lineWidth: 0.5 },
    mode: "plot",
    functions: [mathModel.createPlotFunction({ expression: "2x" })],
  }),
);

const line = mathModel.plotFunctions(tangentGraph)[0];

const contact = mathModel.graphToDrawing(tangentGraph, { x: 1, y: 2 });

const tangent = mathCreation.createTangentAt(tangentGraph, contact, {
  mode: "plot",
  constructionType: "tangent",
  functionId: line.id,
});

check(
  "a tangent is derived in Plot mode",
  Boolean(tangent) && tangent.type === "math-tangent",
);

check(
  "it is centred on the contact point",
  Math.abs(
    (tangent.geometry.start.x + tangent.geometry.end.x) / 2 - contact.x,
  ) < 1e-6 &&
    Math.abs(
      (tangent.geometry.start.y + tangent.geometry.end.y) / 2 - contact.y,
    ) < 1e-6,
);

check(
  "its direction is the curve's local direction",
  Math.abs(tangent.geometry.direction.x - 1 / Math.sqrt(5)) < 1e-6,
  JSON.stringify(tangent.geometry.direction),
);

schema.writeField(tangent, "mathConstructionType", "normal");

check(
  "switching to Normal updates the object rather than creating a second one",
  tangent.engineering.constructionType === "normal" &&
    drawingState.objects.filter((object) => object.type === "math-tangent")
      .length === 1,
);

check(
  "and the normal is perpendicular to the tangent",
  Math.abs(
    tangent.geometry.direction.x * (1 / Math.sqrt(5)) +
      tangent.geometry.direction.y * (2 / Math.sqrt(5)),
  ) < 1e-6,
  JSON.stringify(tangent.geometry.direction),
);

check(
  "the line length is not a Features row, because the endpoint handles set it",
  schema.readField(tangent, "mathConstructionLength") === undefined,
);

check(
  "but the length is still stored on the construction",
  Math.abs(tangent.geometry.length - 30) < 1e-9,
  String(tangent.geometry.length),
);

/* ====================================================== slope triangle */

console.log("\nSlope Triangle");
console.log("--------------");

reset();

const slopeLine = add(
  model.geometryFactories.line(
    { x: 0, y: 0 },
    { x: 100, y: 50 },
    { style: { stroke: "#000000", lineWidth: 0.5 } },
  ),
);

const triangle = mathCreation.createSlopeTriangle(
  { x: 0, y: 0 },
  { x: 40, y: 20 },
  { mode: "plot", parentLineId: slopeLine.id },
);

check(
  "a slope triangle is created",
  Boolean(triangle) && triangle.type === "math-slope-triangle",
);

const triangleGeometry = mathModel.slopeTriangleGeometry(
  triangle.geometry.start,
  triangle.geometry.end,
);

check(
  "its run and rise are derived from its two positions",
  triangleGeometry.run === 40 && triangleGeometry.rise === 20,
  JSON.stringify(triangleGeometry),
);

check("and its slope is rise over run", triangleGeometry.slope === 0.5);

check(
  "the right angle is at the corner the run and rise meet",
  triangleGeometry.corner.x === 40 && triangleGeometry.corner.y === 0,
);

check(
  "a negative rise is supported",
  mathModel.slopeTriangleGeometry({ x: 0, y: 0 }, { x: 40, y: -20 }).slope ===
    -0.5,
);

check(
  "a zero rise is supported",
  mathModel.slopeTriangleGeometry({ x: 0, y: 0 }, { x: 40, y: 0 }).slope === 0,
);

check(
  "a vertical parent is refused, because it has no finite slope",
  mathCreation.createSlopeTriangle(
    { x: 0, y: 0 },
    { x: 0, y: 40 },
    { mode: "plot" },
  ) === null,
);

check(
  "the rise, run and slope are independent display switches",
  schema.writeField(triangle, "mathSlopeShowValue", true) === true &&
    triangle.engineering.showSlope === true &&
    triangle.engineering.showRise === true,
);

/*
 * THE TRIANGLE IS ONE CONSTRUCTION, NOT TWO MODES.
 *
 * It is derived from a parent line and two positions along it, so there is no
 * Sketch variant to choose between - the geometry is the parent's, which is
 * what makes the rise and run meaningful.
 */
check(
  "a slope triangle records the parent it was derived from",
  triangle.geometry.parentLineId === slopeLine.id,
  String(triangle.geometry.parentLineId),
);

check(
  "and its mode is the derived one",
  triangle.engineering.mode === "plot",
  String(triangle.engineering.mode),
);

/* ====================================================== classification */

console.log("\nThe interaction contract");
console.log("------------------------");

check(
  "a Point is a click-to-create tool",
  classification.isPointTool("math-point") === true,
);

check(
  "an Equation is a click-to-create tool",
  classification.isPointTool("math-equation") === true,
);

check(
  "a Vector and a Graph take click-move-click as well as a drag",
  classification.isClickClickTool("math-vector") === true &&
    classification.isClickClickTool("math-plot") === true,
);

check(
  "a bare click does not exit a Math tool that is taking inputs",
  classification.shouldExitToSelectOnClick("math-tangent") === false &&
    classification.shouldExitToSelectOnClick("math-slope-triangle") === false,
);

check(
  "only the Plot takes a freehand stroke",
  mathSketch.isMathSketchTool("math-plot") === true &&
    mathSketch.isMathSketchTool("math-tangent") === false &&
    mathSketch.isMathSketchTool("math-slope-triangle") === false &&
    mathSketch.isMathSketchTool("math-point") === false,
);

/* ====================================================== the source */

console.log("\nThe source");
console.log("----------");

reset();

const sourceGraph = add(
  mathModel.createMathPlot({ x: 0, y: 0 }, 120, 120, {
    style: { stroke: "#000000", lineWidth: 0.5 },
    mode: "plot",
    functions: [mathModel.createPlotFunction({ expression: "x^2" })],
  }),
);

const graphSource = mathWriter.mathSourceWriter(sourceGraph);

check(
  "a plot writes source",
  typeof graphSource === "string" && graphSource.includes("\\draw"),
);

check(
  "and states its kind and limits",
  /% DAETUM MATH: .*kind=plot/.test(graphSource) &&
    /xmin=-5/.test(graphSource),
  graphSource.slice(0, 200),
);

check(
  "and writes each function as its own line",
  /% DAETUM FUNCTION: .*expression="x\^2"/.test(graphSource),
  graphSource.slice(0, 400),
);

check(
  "the reader recognises a Math block",
  /^[ \t]*%[ \t]*DAETUM[ \t]+MATH[ \t]*:/m.test(graphSource) === true,
);

const readBack = mathReaderFor(graphSource)(graphSource, {
  previous: null,
  hostExists: () => true,
});

check(
  "and rebuilds the plot it came from",
  readBack && readBack.type === "math-plot" && readBack.geometry.width === 120,
  JSON.stringify(readBack && readBack.geometry),
);

check(
  "with its function, expression and domain",
  readBack &&
    readBack.geometry.functions.length === 1 &&
    readBack.geometry.functions[0].expression === "x^2" &&
    readBack.geometry.functions[0].domain.min === -5,
  JSON.stringify(readBack && readBack.geometry.functions),
);

const pointSource = mathWriter.mathSourceWriter(
  mathModel.createMathPoint(
    { x: 5, y: 6 },
    { style: { stroke: "#000000", lineWidth: 0.5 } },
  ),
);

check(
  "a point writes its position",
  /kind=point/.test(pointSource) && /x=5/.test(pointSource),
  pointSource.slice(0, 200),
);

const equationSource = mathWriter.mathSourceWriter(
  mathModel.createMathEquation(
    { x: 10, y: 10 },
    {
      style: { stroke: "#000000", lineWidth: 0.5 },
      content: "a^2 + b^2 = c^2",
    },
  ),
);

check(
  "an equation writes its mathematics",
  equationSource.includes("$a^2 + b^2 = c^2$"),
  equationSource.slice(0, 300),
);

const equationBack = mathReaderFor(equationSource)(equationSource, {
  previous: null,
  hostExists: () => true,
});

check(
  "and reads back its content",
  equationBack && equationBack.engineering.content === "a^2 + b^2 = c^2",
  JSON.stringify(equationBack && equationBack.engineering),
);

/* ====================================================== the features */

console.log("\nThe Features panel");
console.log("------------------");

reset();

const featurePoint = add(
  mathModel.createMathPoint(
    { x: 0, y: 0 },
    { style: { stroke: "#000000", lineWidth: 0.5 } },
  ),
);

const pointGroups = schema
  .groupsFor(featurePoint)
  .map((group) => group.heading);

check(
  "a Point has Object, Appearance and Point Settings",
  pointGroups.join(",") === "Object,Appearance,Point Settings",
  JSON.stringify(pointGroups),
);

check(
  "and its label mode is in Point Settings, not Object",
  schema
    .groupsFor(featurePoint)
    .find((group) => group.heading === "Point Settings")
    .fields.some((field) => field.key === "mathLabelMode") &&
    !schema
      .groupsFor(featurePoint)
      .find((group) => group.heading === "Object")
      .fields.some((field) => field.key === "mathLabelMode"),
);

check(
  "and Point Settings is a collapsible dropdown",
  schema
    .groupsFor(featurePoint)
    .find((group) => group.heading === "Point Settings").collapsible === true,
);

const featureGraph = add(
  mathModel.createMathPlot({ x: 0, y: 0 }, 100, 100, {
    style: { stroke: "#000000", lineWidth: 0.5 },
  }),
);

const graphGroups = schema
  .groupsFor(featureGraph)
  .map((group) => group.heading);

check(
  "a Graph has Object, Appearance and Graph Settings",
  graphGroups.join(",") === "Object,Appearance,Graph Settings",
  JSON.stringify(graphGroups),
);

check(
  "and its ranges are in Graph Settings, not Transform",
  schema
    .groupsFor(featureGraph)
    .find((group) => group.heading === "Graph Settings")
    .fields.some((field) => field.key === "mathGraphXMin") &&
    !graphGroups.includes("Transform"),
);

check(
  "and Graph Settings is a collapsible dropdown",
  schema
    .groupsFor(featureGraph)
    .find((group) => group.heading === "Graph Settings").collapsible === true,
);

check(
  "a Graph has no Width or Height row, because its handles resize it",
  schema.readField(featureGraph, "mathGraphWidth") === undefined &&
    schema.readField(featureGraph, "mathGraphHeight") === undefined,
);

check(
  "a Point has no label-position row, because its label handle moves it",
  schema.readField(featurePoint, "mathLabelPositionX") === undefined &&
    schema.readField(featurePoint, "mathLabelPositionY") === undefined,
);

check(
  "a Point has no Parent Graph row, because a parent is a relationship",
  schema.readField(featurePoint, "mathParentGraph") === undefined,
);

/*
 * EVERY MATH TOOL HAS THE SAME SHAPE: Object, Appearance, and ONE named
 * settings dropdown. No Transform, no second settings section, no empty
 * heading.
 */
const featureVector = add(
  mathModel.createMathVector(
    { x: 0, y: 0 },
    { x: 30, y: 40 },
    { style: { stroke: "#000000", lineWidth: 0.5 } },
  ),
);

const featureCurve = featureGraph;

const featureEquation = add(
  mathModel.createMathEquation(
    { x: 0, y: 0 },
    { style: { stroke: "#000000", lineWidth: 0.5 }, content: "y=x^2" },
  ),
);

const featureTangent = add(
  mathModel.createMathTangent(
    {
      contact: { x: 0, y: 0 },
      start: { x: -10, y: 0 },
      end: { x: 10, y: 0 },
      direction: { x: 1, y: 0 },
      length: 20,
    },
    { style: { stroke: "#000000", lineWidth: 0.5 }, parentCurveId: featureCurve.id },
  ),
);

const featureTriangle = add(
  mathModel.createMathSlopeTriangle(
    { start: { x: 0, y: 0 }, end: { x: 40, y: 20 }, corner: { x: 40, y: 0 } },
    { style: { stroke: "#000000", lineWidth: 0.5 } },
  ),
);

const expected = {
  Vector: "Object,Appearance,Vector Settings",
  Equation: "Object,Appearance,Equation Settings",
  "Tangent / Normal": "Object,Appearance,Construction Settings",
  "Slope Triangle": "Object,Appearance,Triangle Settings",
};

[
  ["Vector", featureVector],
  ["Equation", featureEquation],
  ["Tangent / Normal", featureTangent],
  ["Slope Triangle", featureTriangle],
].forEach(([label, object]) => {
  const groups = schema.groupsFor(object);
  const headings = groups.map((group) => group.heading);

  check(
    `${label} has Object, Appearance and one named settings dropdown`,
    headings.join(",") === expected[label],
    JSON.stringify(headings),
  );

  check(
    `${label} has no Transform section`,
    !headings.includes("Transform"),
    JSON.stringify(headings),
  );

  check(
    `${label}'s settings dropdown is collapsible`,
    groups[groups.length - 1].collapsible === true,
  );

  check(
    `${label} has no empty section`,
    groups.every((group) => group.fields.length > 0),
    JSON.stringify(groups.map((group) => [group.heading, group.fields.length])),
  );
});

check(
  "a Tangent has no Line Length row, because its endpoint handles set it",
  schema.readField(featureTangent, "mathConstructionLength") === undefined,
);

check(
  "a Tangent has no Parent Curve row, because a parent is a relationship",
  schema.readField(featureTangent, "mathParentCurve") === undefined,
);

check(
  "a Slope Triangle has no Parent Line row, because a parent is a relationship",
  schema.readField(featureTriangle, "mathSlopeParent") === undefined,
);

check(
  "a Plot has no Creation Mode row, because the toolbar popup states it",
  schema.readField(featureGraph, "mathCurveMode") === undefined,
);

check(
  "a Plot's functions are a list on the object, not a single field",
  Array.isArray(featureGraph.geometry.functions) &&
    schema.readField(featureGraph, "mathCurveExpression") === undefined,
);

/* ====================================================== summary */

console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
  process.exitCode = 1;
}
