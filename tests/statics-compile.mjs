/*
 * Compile the Statics generator's output with the application's own engine.
 *
 * The test suite checks the SHAPE of the code; this checks that TeX reads it.
 * It draws one object of every source-backed Statics type and compiles the
 * picture and its standalone document, reporting the first failure.
 */
import { loadTikz, renderTikz } from "../server/tikz.js";
import {
  generateStaticsTikz,
  wrapAsStandaloneTex,
} from "../src/shared/rendering/latex/source-writers/statics.js";

const style = { stroke: "#193335", lineWidth: 0.75, lineType: "solid" };

const objects = [
  {
    id: "p1",
    type: "particle",
    name: "Particle 1",
    geometry: { position: { x: 10, y: 10 } },
    style,
  },
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
    style,
  },
  {
    id: "b1",
    type: "beam",
    name: "Beam 1",
    geometry: { start: { x: 0, y: 0 }, end: { x: 120, y: 0 } },
    style,
  },
  {
    id: "t1",
    type: "truss",
    name: "Truss 1",
    geometry: { start: { x: 0, y: 40 }, end: { x: 120, y: 40 }, panels: 4 },
    style,
  },
  {
    id: "c1",
    type: "cable",
    name: "Cable 1",
    geometry: { start: { x: 0, y: 70 }, end: { x: 120, y: 70 }, sag: 10 },
    style,
  },
  {
    id: "s1",
    type: "shaft",
    name: "Shaft 1",
    geometry: { start: { x: 0, y: 90 }, end: { x: 120, y: 90 }, diameter: 12 },
    style,
  },
  {
    id: "f1",
    type: "force",
    name: "F1",
    geometry: { start: { x: 20, y: 0 }, magnitude: 40, angle: 90 },
    style,
  },
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
    style,
  },
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
    style,
  },
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
    style,
  },
  {
    id: "su1",
    type: "pin-support",
    name: "Pin",
    geometry: {
      position: { x: 0, y: 0 },
      orientation: -1.5708,
      flipped: false,
    },
    style,
  },
  {
    id: "su2",
    type: "roller-support",
    name: "Roller",
    geometry: {
      position: { x: 120, y: 0 },
      orientation: -1.5708,
      flipped: false,
    },
    style,
  },
  {
    id: "su3",
    type: "fixed-support",
    name: "Fixed",
    geometry: { position: { x: 0, y: 0 }, orientation: 0, flipped: false },
    style,
  },
  {
    id: "su4",
    type: "smooth-support",
    name: "Smooth",
    geometry: {
      position: { x: 10, y: 0 },
      orientation: -1.5708,
      flipped: false,
    },
    style,
  },
  {
    id: "j1",
    type: "pin-connection",
    name: "J1",
    geometry: { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
    style,
  },
  {
    id: "j2",
    type: "fixed-connection",
    name: "J2",
    geometry: { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
    style,
  },
  {
    id: "j3",
    type: "slider-connection",
    name: "J3",
    geometry: { start: { x: 10, y: 10 }, end: { x: 40, y: 10 } },
    style,
  },
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
    style,
  },
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
    style,
  },
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
      ],
      showValues: true,
      results: [{ x: 2, value: 6 }],
    },
    style,
  },
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
    style,
  },
  {
    id: "ref1",
    type: "point",
    name: "P1",
    geometry: { position: { x: -100, y: 40 } },
    style,
  },
  {
    id: "ref2",
    type: "line",
    name: "L1",
    geometry: { start: { x: -100, y: 30 }, end: { x: -60, y: 30 } },
    style: { ...style, lineType: "construction" },
  },
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
    style,
  },
];

await loadTikz();

const picture = `\\begin{tikzpicture}[x=1mm, y=1mm]\n${generateStaticsTikz(objects)}\n\\end{tikzpicture}`;

try {
  const svg = await renderTikz(picture);
  console.log(`picture compiled: ${svg.length} bytes of SVG`);
} catch (error) {
  console.error("picture FAILED:", error.message);
  process.exitCode = 1;
}

try {
  const document = wrapAsStandaloneTex(picture);
  await renderTikz(document);
  console.log("standalone document compiled");
} catch (error) {
  console.error("standalone FAILED:", error.message);
  process.exitCode = 1;
}
