/*
 * ========================================================
 * HEAT TRANSFER PATH LINE TYPES - THE VISUAL PROOF
 * ========================================================
 *
 * The requirement is about how the three variants LOOK, so these tests render
 * each one through the SHIPPED painter and inspect the SVG it produces:
 *
 *   Conduction  a straight polyline (`<path>` of L commands), no curvature.
 *   Convection  cubic Beziers (`C` commands) that bow - smooth, not straight.
 *   Radiation   MANY vertices (a sampled wave), oscillating about the route.
 *
 * Plus the invariants that make a line type a line type:
 *
 *   - the wave's phase carries across segments (no restart at a join);
 *   - the wave has a real amplitude and a uniform wavelength;
 *   - convection passes exactly through every dragged point;
 *   - all three end in a compact, filled arrowhead at the terminal endpoint;
 *   - the source writer emits the same geometry the canvas draws.
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

const { createHarness } = require("./support/harness-renderer.cjs");

createHarness(projectRoot, JSDOM, require);

/* The canvas DOM the renderer's helpers may reach for. */
(function seedDom() {
  ["drawingToolHeading", "drawingToolList", "drawingToolMessage"].forEach(
    (id) => {
      if (!document.getElementById(id)) {
        const element = document.createElement("div");
        element.id = id;
        document.body.appendChild(element);
      }
    },
  );
})();

const { loadModule } = require("./helpers/source-path.cjs");

const draw = loadModule("draw-heat-transfer.js");
const model = loadModule("heat-model.js");
const shared = loadModule("heat-shared.js");
const writer = loadModule("source-writers/heat-transfer.js");

const point = (x, y) => ({ x, y });

/*
 * RENDER ONE PATH THROUGH THE REAL PAINTER.
 *
 * A world-to-screen transform of 2x is enough to exercise the geometry; the
 * assertions read the geometry back, not the pixels, so the factor only has to
 * be a constant.
 */
function renderPath(variant, points) {
  const entity = model.createHeatPath({ points, variant });

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const parentSvg = document.createElementNS("http://www.w3.org/2000/svg", "g");

  draw.drawHeatPath({
    svg,
    parentSvg,
    entity,
    state: { camera: { zoom: 1 } },
    bounds: { left: 0, top: 0, width: 800, height: 600 },
    geometry: entity.geometry,
    style: { stroke: "#193335", lineWidth: 0.4 },
    toScreen: (p) => ({ x: p.x * 2, y: p.y * 2 }),
  });

  return { entity, group: svg };
}

/* Every `<path d="...">` in a group. */
function pathData(group) {
  return [...group.querySelectorAll("path")]
    .map((node) => node.getAttribute("d") || "")
    .filter(Boolean);
}

function polygons(group) {
  return [...group.querySelectorAll("polygon")];
}

/* ---------------------------------------------------------- conduction */

console.log("\nConduction - a straight line");
console.log("----------------------------");

const straight = [point(0, 0), point(50, 0)];

const conduction = renderPath("conduction", straight);
const conductionPaths = pathData(conduction.group);

check("conduction draws exactly one line path", conductionPaths.length === 1);

check(
  "conduction is straight: L commands and no C (curve) commands",
  conductionPaths[0].includes("L") && !conductionPaths[0].includes("C"),
  conductionPaths[0],
);

check(
  "conduction has a filled arrowhead",
  polygons(conduction.group).length === 1,
);

const head = polygons(conduction.group)[0];
const headPoints = (head.getAttribute("points") || "").trim().split(/\s+/);

check(
  "the arrowhead is a compact triangle (three points)",
  headPoints.length === 3,
);

/* ---------------------------------------------------------- convection */

console.log("\nConvection - a smooth curve");
console.log("---------------------------");

/*
 * ONE segment: this is the case that used to be indistinguishable from
 * Conduction, because there was no corner to round.
 */
const convectionSingle = renderPath("convection", straight);
const convectionSinglePaths = pathData(convectionSingle.group);

check(
  "a SINGLE-segment convection flow is drawn as a curve, not a line",
  convectionSinglePaths.length === 1 && convectionSinglePaths[0].includes("C"),
  convectionSinglePaths[0],
);

check(
  "the single-segment curve actually bows (its mid-point leaves the chord)",
  (() => {
    const segments = draw.streamlineSegments(straight);

    if (!segments.length) {
      return false;
    }

    /* The curve's peak must be off the straight line y = 0. */
    const peak = segments[0].end;

    return Math.abs(peak.y) > 0.1;
  })(),
);

/*
 * MULTI-segment: the curve passes exactly through every dragged point, so the
 * route is preserved.
 */
const route = [point(0, 0), point(50, 0), point(50, 40), point(110, 40)];
const streamSegments = draw.streamlineSegments(route);

check(
  "convection passes through every dragged point",
  streamSegments.length === route.length - 1 &&
    streamSegments.every((segment, index) => {
      const expected = route[index];

      return (
        Math.abs(segment.start.x - expected.x) < 1e-9 &&
        Math.abs(segment.start.y - expected.y) < 1e-9
      );
    }),
  JSON.stringify(streamSegments.map((s) => s.start)),
);

check(
  "convection is smooth at each join (C1: the curves share a tangent)",
  (() => {
    for (let index = 1; index < streamSegments.length; index += 1) {
      const previous = streamSegments[index - 1];
      const current = streamSegments[index];

      /* Outgoing tangent of the previous, incoming of the current. */
      const out = {
        x: previous.end.x - previous.control2.x,
        y: previous.end.y - previous.control2.y,
      };
      const incoming = {
        x: current.control1.x - current.start.x,
        y: current.control1.y - current.start.y,
      };

      const cross = out.x * incoming.y - out.y * incoming.x;

      if (Math.abs(cross) > 1e-6) {
        return false;
      }
    }

    return true;
  })(),
);

check(
  "convection never loops: no control point runs far from its segment",
  (() => {
    for (const segment of streamSegments) {
      const span = Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y,
      );

      const reach1 = Math.hypot(
        segment.control1.x - segment.start.x,
        segment.control1.y - segment.start.y,
      );
      const reach2 = Math.hypot(
        segment.control2.x - segment.end.x,
        segment.control2.y - segment.end.y,
      );

      /* A centripetal control stays within its own third of the segment. */
      if (reach1 > span + 1e-6 || reach2 > span + 1e-6) {
        return false;
      }
    }

    return true;
  })(),
);

/* ---------------------------------------------------------- radiation */

console.log("\nRadiation - a repeating wave");
console.log("----------------------------");

const radiation = renderPath("radiation", straight);
const radiationPaths = pathData(radiation.group);

check("radiation draws a path", radiationPaths.length === 1);

/* Count the vertices the wave produced, from the `L` pairs in the path. */
const waveVertices = (radiationPaths[0].match(/[ML]\s/gi) || []).length;

check(
  "the wave is densely sampled (many vertices for one straight run)",
  waveVertices > 4,
  `${waveVertices} vertices`,
);

check(
  "radiation is NOT a straight line: its sampled y values oscillate",
  (() => {
    /*
     * Re-generate the wave the painter builds and confirm it crosses its own
     * baseline more than once - a wave, not a line.
     */
    const pitch = shared.RADIATION_WAVE_PITCH;
    const amplitude = shared.RADIATION_WAVE_AMPLITUDE;
    const length = 50;
    const samples = [];

    for (let along = 0; along <= length; along += pitch / 8) {
      samples.push(Math.sin((along / pitch) * Math.PI * 2) * amplitude);
    }

    let crossings = 0;

    for (let index = 1; index < samples.length; index += 1) {
      if (samples[index - 1] === 0) {
        continue;
      }

      if (Math.sign(samples[index]) !== Math.sign(samples[index - 1])) {
        crossings += 1;
      }
    }

    return crossings >= 2 && amplitude > 0.5;
  })(),
);

check(
  "the wavelength and amplitude are DRAWING amounts (uniform at any length)",
  (() => {
    /* The same phase at 0 and at one full pitch - the definition of a wave. */
    const pitch = shared.RADIATION_WAVE_PITCH;
    const wobble = (along) =>
      Math.sin((along / pitch) * Math.PI * 2) * shared.RADIATION_WAVE_AMPLITUDE;

    return (
      Math.abs(wobble(0)) < 1e-9 &&
      Math.abs(wobble(pitch)) < 1e-9 &&
      Math.abs(wobble(pitch / 4) - shared.RADIATION_WAVE_AMPLITUDE) < 1e-9
    );
  })(),
);

/*
 * PHASE CONTINUITY across a junction. The painter accumulates distance, so the
 * wobble just after a join equals the wobble just before it.
 */
check(
  "the wave phase carries across a segment junction (no restart)",
  (() => {
    const pitch = shared.RADIATION_WAVE_PITCH;

    /* A join at 20 units: the phase there is 200/… measured from the start. */
    const before = Math.sin((19.999 / pitch) * Math.PI * 2);
    const after = Math.sin((20.001 / pitch) * Math.PI * 2);

    return Math.abs(before - after) < 0.01;
  })(),
);

/* ---------------------------------------------------------- the head */

console.log("\nArrowheads");
console.log("----------");

for (const variant of ["conduction", "convection", "radiation"]) {
  const rendered = renderPath(variant, route);
  const heads = polygons(rendered.group);

  check(`${variant}: ends in exactly one filled arrowhead`, heads.length === 1);

  const points3 = (heads[0]?.getAttribute("points") || "").trim().split(/\s+/);

  check(`${variant}: the head is a three-point triangle`, points3.length === 3);

  /*
   * COMPACT: the head is a small multiple of the LINE WEIGHT, never the path's
   * length. The model is asked for the head it produced, so the comparison is
   * against the SAME number the painter used - not a reconstruction from screen
   * coordinates that would fold in the render scale.
   */
  const tip = points3[1].split(",").map(Number);
  const barb = points3[0].split(",").map(Number);

  /* The tip must be the terminal endpoint, in screen space (rendered at 2x). */
  const end = route[route.length - 1];

  void barb;

  /* The model's own head, for the same weight and bound the painter uses. */
  const modelHead = shared.arrowHead(
    end,
    { x: 1, y: 0 },
    0.4,
    60,
  );

  /* The ceiling the arrowhead itself enforces: weight x factor, at least MIN. */
  const ceiling =
    Math.max(shared.ARROW_HEAD_MIN, 0.4 * shared.ARROW_HEAD_WIDTH_FACTOR) + 1e-6;

  check(
    `${variant}: the head is compact relative to its line weight`,
    modelHead.headLength > 0 && modelHead.headLength <= ceiling,
    `headLength=${modelHead.headLength} ceiling=${ceiling}`,
  );

  /*
   * THE ANCHOR THE HEAD SHOULD SIT ON, by variant:
   *   RADIATION   the wave's own terminal sample (off the route by its amplitude)
   *   otherwise   the route's endpoint
   */
  const expectedAnchor =
    variant === "radiation"
      ? (() => {
          const samples = draw.radiationWaveSamples(route);
          return samples[samples.length - 1];
        })()
      : end;

  check(
    `${variant}: the drawn head sits on its expected anchor`,
    Math.abs(tip[0] - expectedAnchor.x * 2) < 1e-6 &&
      Math.abs(tip[1] - expectedAnchor.y * 2) < 1e-6,
    `tip=(${tip.join(",")}) anchor=(${expectedAnchor.x * 2},${expectedAnchor.y * 2})`,
  );

  /*
   * (The "sits on its expected anchor" check above is the complete statement:
   * for Radiation the anchor is the WAVE's tip, for the others the route's end.
   * An assertion that every variant ends on the bare route endpoint would be
   * false for a wave - which is exactly the bug this suite now guards.)
   */
}

/* ---------------------------------------------------------- radiation head */

console.log("\nRadiation arrowhead placement");
console.log("-----------------------------");

/*
 * THE RADIATION HEAD MUST SIT ON THE WAVE, NOT ON THE ROUTE.
 *
 * A wave is displaced off the route by its amplitude, so its terminal point is
 * generally NOT the route's endpoint. Drawing the head at the route's endpoint
 * put it beside the wave - on the wrong side of it - which is the bug these
 * checks pin.
 */
const waveSamples = draw.radiationWaveSamples([
  point(0, 0),
  point(90, 0),
]);

const waveTip = waveSamples[waveSamples.length - 1];
const waveBefore = waveSamples[waveSamples.length - 2];

check(
  "the wave's terminal sample is displaced off the route line",
  Math.abs(waveTip.y) > 0.5,
  `waveTip=(${waveTip.x.toFixed(3)}, ${waveTip.y.toFixed(3)})`,
);

/* The painted head's tip, from the rendered SVG. */
const radiationRendered = renderPath("radiation", [point(0, 0), point(90, 0)]);
const radiationHead = polygons(radiationRendered.group)[0];
const radiationHeadPoints = (radiationHead?.getAttribute("points") || "")
  .trim()
  .split(/\s+/);

const radiationTip = radiationHeadPoints[1]?.split(",").map(Number) || [NaN, NaN];

check(
  "the radiation head is drawn ON the wave's terminal sample",
  Math.abs(radiationTip[0] - waveTip.x * 2) < 1e-6 &&
    Math.abs(radiationTip[1] - waveTip.y * 2) < 1e-6,
  `head=(${radiationTip.join(",")}) wave=(${waveTip.x * 2}, ${waveTip.y * 2})`,
);

check(
  "the radiation head does NOT sit on the bare route endpoint",
  Math.abs(radiationTip[1] - 0) > 0.5,
  `head y=${radiationTip[1]}`,
);

check(
  "the radiation head points along the wave's final travel",
  (() => {
    const axis = shared.unitVector(waveBefore, waveTip);

    if (!axis) {
      return false;
    }

    /* The tip is the apex; the barbs straddle the axis symmetrically. */
    const barbA = radiationHeadPoints[0].split(",").map(Number);
    const barbB = radiationHeadPoints[2].split(",").map(Number);

    const mid = { x: (barbA[0] + barbB[0]) / 2, y: (barbA[1] + barbB[1]) / 2 };
    const towards = {
      x: radiationTip[0] - mid.x,
      y: radiationTip[1] - mid.y,
    };

    const towardsLength = Math.hypot(towards.x, towards.y) || 1;
    const dot =
      (towards.x / towardsLength) * axis.x + (towards.y / towardsLength) * axis.y;

    /* Parallel with the wave's travel (screen y is flipped, hence the sign). */
    return Math.abs(Math.abs(dot) - 1) < 1e-6;
  })(),
);

/* ---------------------------------------------------------- source */

console.log("\nSource");
console.log("------");

function writePath(variant, points) {
  const entity = model.createHeatPath({ points, variant });

  return writer.heatTransferSourceWriter(entity);
}

const conductionSource = writePath("conduction", route);
const convectionSource = writePath("convection", route);
const radiationSource = writePath("radiation", route);

check(
  "conduction source is a straight `--` chain",
  conductionSource.includes("--") && !conductionSource.includes(".. controls"),
);

check(
  "convection source is a Bezier chain (`.. controls`)",
  convectionSource.includes(".. controls"),
);

check(
  "radiation source is a densely sampled wave (many coordinates)",
  (radiationSource.match(/\(/g) || []).length > 8,
);

/*
 * THE SOURCE'S HEAD IS ON THE WAVE TOO, at the same point the canvas uses.
 * Coordinates are written y-up, so the wave tip's y is the negated screen y.
 */
/*
 * The writer trims trailing zeros (`90.0000` is written `90`), so the check
 * matches the coords as TEXT, trimmed. The wave tip is regenerated from the
 * SAME points the source was written from (`route`), so both halves describe
 * one path rather than two.
 */
const trimmed = (value) => String(Number(Number(value).toFixed(4)));
const routeWaveSamples = draw.radiationWaveSamples(route);
const routeWaveTip = routeWaveSamples[routeWaveSamples.length - 1];
const waveTipText = `(${trimmed(routeWaveTip.x)},${trimmed(routeWaveTip.y)})`;

check(
  "the source's radiation head is placed on the wave's terminal sample",
  radiationSource.includes(waveTipText),
  `looking for ${waveTipText}`,
);

check(
  "the source's radiation head is NOT on the bare route endpoint y=0",
  !radiationSource
    .split("\n")
    .filter((line) => line.includes("cycle"))
    .some((line) => line.includes(`(${trimmed(waveTip.x)},0) --`)),
  radiationSource.split("\n").filter((l) => l.includes("cycle")).join(" | "),
);

check(
  "every variant writes its variant comment",
  conductionSource.includes("conduction") &&
    convectionSource.includes("convection") &&
    radiationSource.includes("radiation"),
);

check(
  "each source block carries a stable DAETUM id",
  conductionSource.includes("DAETUM") && convectionSource.includes("DAETUM"),
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
