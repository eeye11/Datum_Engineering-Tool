
const { JSDOM } = require("jsdom");

const path = require("path");
const fs = require("fs");

const { loadModule, locate, modulePath, sourceDir } = require("./helpers/source-path.cjs");
/*
 * ========================================================
 * DO ALL THE VECTORS POINT THE SAME WAY?
 * ========================================================
 *
 * A Statics sheet mixes five kinds of arrow - a Point Force, a Resultant,
 * a Force Components' three vectors, and the two distributed loads - and a
 * student comparing them is comparing arrowheads. If two of them decide
 * their direction differently, the drawing is making a claim it cannot
 * back up, and it does so silently.
 *
 * ========================================================
 * THE CONVENTION
 * ========================================================
 *
 *     tail --> head,   and the head sits at `head`.
 *
 * Derived from the two endpoints, in screen space, after the world-to-
 * screen transform. Not from a sign, and not from an angle that has been
 * negated to compensate for something else.
 *
 * This has been got wrong twice, in two different ways, and both are worth
 * recording:
 *
 *   1. A force-only routine took an ANGLE and rebuilt the tip with
 *      `y: anchor.y - Math.sin(angle) * length`. The anchor was already a
 *      SCREEN point, so that minus inverted the vector a second time. The
 *      caller passed a negated angle to compensate, and the two errors
 *      cancelled - which is why it survived, and why neither could be
 *      changed without breaking the other.
 *
 *   2. A direction was recovered from two screen points with
 *      `atan2(-dy, dx)` and handed to a routine that applied its own
 *      inversion, for the same reason.
 *
 * Both are the same mistake: doing the world-to-screen conversion twice,
 * in two places, with the errors arranged to cancel.
 *
 * So the shared renderer takes TWO POINTS and measures its own direction,
 * and this checks every vector type against that one rule - including the
 * loads, which use a different head SHAPE but must use the same rule for
 * which end the head is on.
 */


const projectRoot = path.join(__dirname, "..");

let pass = 0;
let fail = 0;

const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(
      `  FAIL ${name}${detail ? `\n       ${detail}` : ""}`,
    );
  }
};

const dom = new JSDOM(
  '<!doctype html><html><body><div id="canvas"></div></body></html>',
  { pretendToBeVisual: true },
);

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.requestAnimationFrame = cb => setTimeout(cb, 0);
global.window.requestAnimationFrame = global.requestAnimationFrame;
global.window.cancelAnimationFrame = id => clearTimeout(id);

for (const name of [
  "measurement-core.js",
  "quantities.js",
  "dimension-model.js",
  "annotation-model.js",
  "diagram-equations.js",
  "load-profile.js",
  "body-frames.js",
  "feature-geometry.js",
  "drawing-state.js",
  "renderer.js",
]) {
  loadModule(name);
}

for (const name of [
  "enggDrawingState",
  "enggDrawingRenderer",
  "enggLoadProfile",
  "enggDiagramEquations",
  /*
   * The renderer also reaches the body frames and the feature geometry by
   * their bare names, which resolve in a browser because every script shares
   * one scope and do not under `require`. Without these two the renderer
   * throws part way through a drawing, and every feature after that point is
   * silently absent - so a test about arrowheads can pass with no arrowheads
   * drawn at all.
   */
  "enggBodyFrames",
  "enggFeatureGeometry",
]) {
  if (global.window[name]) {
    global[name] = global.window[name];
  }
}

const renderer = global.window.enggDrawingRenderer;

const canvas = global.document.getElementById("canvas");

canvas.getBoundingClientRect = () => ({
  width: 900,
  height: 600,
  left: 0,
  top: 0,
  right: 900,
  bottom: 600,
});

const base = {
  selection: {
    selectedObjectIds: [],
    boxSelectionIds: [],
    hoveredObjectId: null,
  },
  interaction: {
    phase: "idle",
    preview: null,
    previewObjects: [],
  },
  camera: { zoom: 1, panX: 0, panY: 0 },
  styleDefaults: { stroke: "#000000", lineWidth: 0.5 },
  grid: { visible: false, spacing: 10 },
  snap: { enabled: false },
};

const stroke = { stroke: "#000000", lineWidth: 0.5 };

/* Rendered onto a clear canvas each time. */
function draw(feature) {
  renderer.renderDrawing(
    { ...base, objects: [feature] },
    canvas,
  );

  return canvas.querySelector(
    '.drawing-feature[data-feature-id="' + feature.id + '"]',
  );
}

/*
 * THE SHAFT AND THE HEAD, read off the canvas.
 *
 * A feature group can contain lines that are not arrows - a load's own
 * span along the body is one, and picking it would measure the body rather
 * than the force. So the shaft is chosen by matching: a line is an arrow
 * only if one of its endpoints is a vertex of a head polygon. That is the
 * same definition the renderer uses - a head sits at one end of its shaft -
 * so the test cannot accept a line that has no arrow on it.
 *
 * The apex is the head's vertex AT the shaft's far end, which is what
 * "the tip is at head" means and the same question for every vector type.
 */
function arrow(group) {
  const heads = [...group.querySelectorAll("polygon")]
    .filter(p => p.getAttribute("class") !== "drawing-load-profile")
    .map(p =>
      p
        .getAttribute("points")
        .trim()
        .split(/\s+/)
        .map(pair => {
          const [x, y] = pair.split(",").map(Number);

          return { x, y };
        }),
    );

  if (!heads.length) {
    return null;
  }

  const shaft = [...group.querySelectorAll("line")]
    .map(line => ({
      a: {
        x: Number(line.getAttribute("x1")),
        y: Number(line.getAttribute("y1")),
      },
      b: {
        x: Number(line.getAttribute("x2")),
        y: Number(line.getAttribute("y2")),
      },
    }))
    .find(
      ({ a, b }) =>
        heads.some(points =>
          points.some(
            point =>
              (Math.abs(point.x - a.x) < 0.51 &&
                Math.abs(point.y - a.y) < 0.51) ||
              (Math.abs(point.x - b.x) < 0.51 &&
                Math.abs(point.y - b.y) < 0.51),
          ),
        ),
    );

  if (!shaft) {
    return null;
  }

  /*
   * THE HEAD BELONGING TO THIS SHAFT, AND ITS APEX.
   *
   * A load draws many arrows, so the group holds many head polygons, and
   * pooling their vertices together would answer a question about the
   * whole field rather than about the one arrow under examination. The
   * head is therefore chosen by proximity to this shaft's endpoints.
   *
   * Within one head, the tip is whichever of its three vertices is
   * furthest from the midpoint of the other two. The two builders write
   * their vertices in different orders - the shared one tip-first, the
   * load one tip-last - so reading a fixed position would answer
   * differently for a force and a load, which is exactly the kind of
   * difference this file exists to rule out.
   */
  const head = heads
    .filter(points =>
      points.some(
        point =>
          Math.hypot(
            point.x - shaft.a.x,
            point.y - shaft.a.y,
          ) < 1 ||
          Math.hypot(
            point.x - shaft.b.x,
            point.y - shaft.b.y,
          ) < 1,
      ),
    )
    .sort(
      (first, second) =>
        Math.min(
          ...first.map(point =>
            Math.min(
              Math.hypot(point.x - shaft.a.x, point.y - shaft.a.y),
              Math.hypot(point.x - shaft.b.x, point.y - shaft.b.y),
            ),
          ),
        ) -
        Math.min(
          ...second.map(point =>
            Math.min(
              Math.hypot(point.x - shaft.a.x, point.y - shaft.a.y),
              Math.hypot(point.x - shaft.b.x, point.y - shaft.b.y),
            ),
          ),
        ),
    )[0];

  if (!head) {
    return null;
  }

  const apex = head.reduce((best, point, index, all) => {
    const others = all.filter((_, other) => other !== index);

    const middle = {
      x: (others[0].x + others[1].x) / 2,
      y: (others[0].y + others[1].y) / 2,
    };

    const distance = Math.hypot(
      point.x - middle.x,
      point.y - middle.y,
    );

    return !best || distance > best.distance
      ? { ...point, distance }
      : best;
  }, null);

  return {
    a: shaft.a,
    b: shaft.b,
    apex,
    head,
  };
}

/*
 * ========================================================
 * IS THE HEAD SQUARE TO ITS OWN SHAFT?
 * ========================================================
 *
 * Everything above asks where the TIP is, and the tip was always right.
 * That is what let the head go wrong for as long as it did: an arrowhead
 * whose two base corners sit on the SAME side of the shaft still has its
 * tip in the right place, so every directional test passes and the drawing
 * looks like a fin.
 *
 * So this asks the other question. For a shaft running along unit vector D
 * from tail to head, each base corner's offset from the tip is measured
 * ACROSS that axis by the cross product
 *
 *     cross = ox * Dy - oy * Dx
 *
 * A head is correct exactly when the two corners are on OPPOSITE sides by
 * the SAME amount - the cross products sum to zero and neither is zero.
 *
 * THE MEASUREMENT IS DELIBERATELY ABOUT THE SIGN. "Is it symmetric about
 * the axis" would not catch it: a fin is symmetric in the sense of being
 * lopsided to ONE side, and only the sign of the offset says which side
 * each corner is on.
 */
function headIsSquare(head, shaft) {
  if (!head || head.length !== 3) {
    return null;
  }

  /* The tip is the vertex furthest from the middle of the other two. */
  let tip = null;
  let bases = null;

  head.forEach((point, index) => {
    const others = head.filter((_, i) => i !== index);

    const middle = {
      x: (others[0].x + others[1].x) / 2,
      y: (others[0].y + others[1].y) / 2,
    };

    const d = Math.hypot(
      point.x - middle.x,
      point.y - middle.y,
    );

    if (!tip || d > tip.d) {
      tip = { ...point, d };
      bases = others;
    }
  });

  const length = Math.hypot(
    shaft.b.x - shaft.a.x,
    shaft.b.y - shaft.a.y,
  );

  const d = {
    x: (shaft.b.x - shaft.a.x) / length,
    y: (shaft.b.y - shaft.a.y) / length,
  };

  const crosses = bases.map(corner => {
    const ox = corner.x - tip.x;
    const oy = corner.y - tip.y;

    return ox * d.y - oy * d.x;
  });

  return {
    crosses,
    square:
      Math.abs(crosses[0] + crosses[1]) < 0.01 &&
      Math.abs(crosses[0]) > 0.01,
  };
}

console.log("\n  a Point Force points the way it says it does\n");

/*
 * EIGHT DIRECTIONS, because a sign error is invisible in half of them. A
 * test that only checked +x passes against code that draws every other
 * direction wrong.
 */
[
  ["right", 0, 1, 0],
  ["left", 180, -1, 0],
  ["up", 90, 0, -1],
  ["down", -90, 0, 1],
  ["up-right", 45, 1, -1],
  ["up-left", 135, -1, -1],
  ["down-left", -135, -1, 1],
  ["down-right", -45, 1, 1],
].forEach(([what, angle, wantX, wantY]) => {
  /*
   * BUILT BY THE FACTORY, NOT HAND-WRITTEN.
   *
   * This used to hand `{start, angle, magnitude}` - a force with no stored
   * `end`. That is not a state the application produces: `setForceVector`
   * writes the endpoints, the components and the angle together, so a force
   * carrying an angle always has an `end` beside it.
   *
   * It mattered because the renderer had a second path for the case, which
   * derived the direction from the angle and scaled the magnitude itself,
   * while the main path measured the span. Two paths, two answers - at 270
   * degrees they disagreed, and a force pointing straight down came out
   * pointing down and to the left. The second path is gone; these cases now go
   * through the same one the application does, which is the only way a check
   * of it can mean anything.
   */
  const force = enggDrawingState.geometryFactories.force(
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    {},
  );

  enggLoadProfile.setForceVector(
    force.geometry,
    60,
    angle,
  );

  force.id = `f-${angle}`;
  force.style = stroke;

  const drawn = arrow(draw(force));

  const ok =
    drawn &&
    Math.sign(drawn.b.x - drawn.a.x) === wantX &&
    Math.sign(drawn.b.y - drawn.a.y) === wantY;

  check(
    `a force at ${what} has its head on that side`,
    ok,
    drawn
      ? `head end (${Math.sign(drawn.b.x - drawn.a.x)}, ${Math.sign(drawn.b.y - drawn.a.y)})`
      : "nothing was drawn",
  );

  check(
    `a force at ${what} puts the arrowhead AT that end`,
    drawn &&
      Math.hypot(
        drawn.apex.x - drawn.b.x,
        drawn.apex.y - drawn.b.y,
      ) < 1e-6,
    drawn
      ? `apex ${JSON.stringify(drawn.apex)}, shaft end ${JSON.stringify(drawn.b)}`
      : "nothing was drawn",
  );

  /*
   * THE CHECK THAT WAS MISSING.
   *
   * Every directional assertion above passes with a fin for a head: the
   * tip is still in the right place. The head was drawn with
   *
   *     tip.x - head * cos(theta -/+ 0.4)
   *     tip.y + head * sin(theta -/+ 0.4)
   *
   * - x subtracts, y ADDS - which puts both base corners on the same side
   * of the shaft. And the error is invisible at 0 and 90 degrees, where
   * sin happens to be symmetric, so it only shows on the diagonals. A
   * suite that tested right and up would have passed for as long as the
   * drawing was wrong.
   */
  const square = drawn && headIsSquare(drawn.head, drawn);

  check(
    `a force at ${what} has a head square to its shaft`,
    square && square.square,
    square
      ? `corner offsets across the axis: ${JSON.stringify(
          square.crosses.map(c => Number(c.toFixed(2))),
        )} - the same sign means a fin, not an arrowhead`
      : "nothing was drawn",
  );
});

console.log("\n  a zero force draws nothing rather than a stub\n");

check(
  "a force of magnitude zero is not drawn",
  arrow(
    draw(
      /*
       * THROUGH THE SAME FACTORY, so the zero is a real zero force rather
       * than a shape the application cannot produce.
       */
      (() => {
        const force =
          enggDrawingState.geometryFactories.force(
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            {},
          );

        enggLoadProfile.setForceVector(
          force.geometry,
          0,
          45,
        );

        force.id = "f-zero";
        force.style = stroke;

        return force;
      })(),
    ),
  ) === null,
  "a default arrow pointing somewhere would be a claim about a force that is not there",
);

console.log("\n  a Resultant and a Components pair use the same rule\n");

[
  ["a resultant", "resultant"],
  ["a components pair", "force-components"],
].forEach(([what, type]) => {
  const drawn = arrow(
    draw({
      id: type,
      type,
      geometry: {
        position: { x: 0, y: 0 },
        start: { x: 0, y: 0 },
        end: { x: 60, y: 0 },
        original: {
          start: { x: 0, y: 0 },
          end: { x: 60, y: 0 },
        },
        horizontal: {
          start: { x: 0, y: 0 },
          end: { x: 60, y: 0 },
        },
        vertical: {
          start: { x: 0, y: 0 },
          end: { x: 0, y: 0 },
        },
        magnitude: 60,
        angle: 0,
      },
      style: stroke,
    }),
  );

  check(
    `${what} is drawn`,
    drawn !== null,
  );

  check(
    `${what} puts its head at the far end of the shaft`,
    drawn &&
      Math.hypot(
        drawn.apex.x - drawn.b.x,
        drawn.apex.y - drawn.b.y,
      ) < 1e-6,
    drawn
      ? `apex ${JSON.stringify(drawn.apex)}, shaft end ${JSON.stringify(drawn.b)}`
      : "nothing was drawn",
  );
});

console.log("\n  and so do both loads\n");

/*
 * A LOAD'S HEAD IS ON THE BODY when the load is reversed, and away from it
 * when it is not. That is the same rule as every other vector - the head
 * is at the end the arrow points to - read in the one direction the loads
 * can be reversed in.
 */
[
  ["a load", "load"],
  ["a varying load", "varying-load"],
].forEach(([what, type]) => {
  const geometry =
    type === "load"
      ? {
          start: { x: -50, y: 0 },
          end: { x: 50, y: 0 },
          intensity: 10,
          direction: -90,
          interval: 20,
          points: [
            { t: 0, magnitude: 10 },
            { t: 1, magnitude: 10 },
          ],
        }
      : {
          start: { x: -50, y: 0 },
          end: { x: 50, y: 0 },
          direction: -90,
          startIntensity: 10,
          endIntensity: 10,
        };

  const drawn = arrow(
    draw({
      id: `${type}-plain`,
      type,
      geometry: { ...geometry },
      style: stroke,
    }),
  );

  check(
    `${what} is drawn`,
    drawn !== null,
  );

  /*
   * THE DIRECTION, WHICH IS THE ACTUAL CLAIM.
   *
   * The head does not sit exactly on the shaft's end for a load: its two
   * base corners do, and the tip is inset by the head's own length so the
   * triangle is attached to the line rather than sitting on top of it. So
   * asserting "tip == shaft end" would be asserting an implementation
   * detail of one builder rather than the direction.
   *
   * What has to be true is that the tip is further from the body than the
   * tail is, along the load's direction. A downward load on a level body
   * hangs BELOW it, so the tip must be below the tail on the screen.
   */
  check(
    `${what} points away from the body`,
    drawn && drawn.apex.y > drawn.a.y,
    `tail y=${drawn?.a.y}, tip y=${drawn?.apex.y} - a downward load must point down the screen`,
  );

  check(
    `${what} keeps its tip on the body line`,
    drawn && Math.abs(drawn.apex.x - drawn.a.x) < 0.51,
    `tip x=${drawn?.apex.x}, body line x=${drawn?.a.x}`,
  );
});

/* The whole renderer, which is split by concern across src/rendering/. */
const rendererSource = require("./helpers/source-path.cjs").rendererSource();

/*
 * THE COMMENTS ARE NOT CODE, AND MUST NOT BE READ AS CODE.
 *
 * Both patterns below are described in the prose beside them - that is the
 * whole point of the comment - so searching the raw file satisfies them
 * from the very sentence explaining the mistake. The comments are stripped
 * first and only what would actually execute is searched.
 */
const rendererCode = rendererSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

console.log("\n  one convention, one renderer\n");

/*
 * AND THE LOADS ARE BUILT FROM THE SAME TWO POINTS.
 *
 * The load head was already correct - it negates both components - but it
 * carried its own copy of the shape parameter, and its own copy of the
 * corner arithmetic. Three head builders is three chances to get a sign
 * wrong, and one of them did; a fourth being reachable again would only
 * be a matter of time.
 */
const cornersIn = code => {
  const from =
    code.match(
      /arrowHeadCorners\([\s\S]{0,900}?return \[/,
    )?.[0] || "";

  const loadBuilder =
    code.slice(
      code.indexOf("function distributedLoadArrowHead"),
    );

  return {
    shared: from.length > 0,
    loadUsesIt:
      /arrowHeadCorners\(/.test(
        loadBuilder.split("\n    }")[0] || "",
      ),
  };
};

const corners = cornersIn(rendererCode);

check(
  "the load head is built from the shared corner builder",
  corners.shared && corners.loadUsesIt,
  "a head shape that has been got wrong once should not be reachable twice",
);

check(
  "there is no second copy of the head angle",
  (rendererCode.match(/radians [-+] 0\.4/g) || []).length === 0,
  (rendererCode.match(/radians [-+] 0\.4/g) || [])[0],
);
/*
 * THE ANTI-PATTERN, WHICH MUST NOT COME BACK.
 *
 * A head direction written as a negated screen delta, or a tip rebuilt
 * with a hand-applied `- sin`, is the world-to-screen conversion done a
 * second time by hand. Both had cancelling errors elsewhere, so neither
 * ever threw - they just quietly disagreed with each other in one
 * quadrant at a time.
 */
check(
  "no arrowhead direction is derived from a negated screen delta",
  !/atan2\(\s*-\s*dy\s*,\s*dx\s*\)/.test(rendererCode),
  (rendererCode.match(/atan2\(\s*-\s*dy[\s\S]{0,40}/) || [])[0],
);

check(
  "no vector tip is rebuilt with a hand-applied inversion",
  !/Math\.cos\(radians\)[\s\S]{0,120}- ?Math\.sin\(radians\)/.test(
    rendererCode,
  ),
  "the projection already inverts; doing it twice is how the two errors cancelled",
);

console.log(
  `\n${pass} passed, ${fail} failed\n`,
);

if (fail) {
  process.exitCode = 1;
}
