const { bootApp } = require("./tests/helpers/boot-app.cjs");
const { locate } = require("./tests/helpers/source-path.cjs");

bootApp();

const tool = require(locate("pipe-duct-tool.js"));
const pipe = require(locate("model/fluids/pipe-duct.js")).default;
const state = require(locate("editor-state.js")).drawingState;

state.objects = [];

const a = pipe.createPipeDuct({ x: 0, y: 0 }, { x: 100, y: 0 });
const b = pipe.createPipeDuct({ x: 300, y: 150 }, { x: 100, y: 0 });
state.objects = [a, b];

tool.connectPipeEndpoints(b);

const elbow = state.objects.find((o) => o.type === "elbow");

console.log("elbow angle:", pipe.elbowAngleDegrees(elbow).toFixed(2));
console.log("bend radius:", elbow.engineering.bendRadius);

const curves = pipe.elbowCurvesFor(elbow);
console.log("tangent start:", curves.start, "tangent end:", curves.end);

/* Tangency: the arc's tangent at each end must run along its pipe. */
const inDir = pipe.directionOf(a.geometry.start, a.geometry.end);
const outDir = pipe.directionOf(b.geometry.end, b.geometry.start);

const radialStart = pipe.directionOf(curves.centre, curves.start);
const radialEnd = pipe.directionOf(curves.centre, curves.end);

const perp = (u, v) => Math.abs(u.x * v.x + u.y * v.y);
console.log(
  "start radial . pipe dir (want 0):",
  perp(radialStart, inDir).toFixed(6),
);
console.log(
  "end radial . pipe dir (want 0):",
  perp(radialEnd, outDir).toFixed(6),
);

console.log("outer endpoints preserved:");
console.log("  a.start:", a.geometry.start, "(was {x:0,y:0})");
console.log("  b.start:", b.geometry.start, "(was {x:300,y:150})");
console.log("  a.end  :", a.geometry.end, "(moved to the tangent point)");

setTimeout(() => process.exit(0), 300);
