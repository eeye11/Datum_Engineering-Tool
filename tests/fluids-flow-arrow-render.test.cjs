/* eslint-disable no-console */
/*
 * ========================================================
 * THE FLOW ARROW IN THE REAL ENGINE
 * ========================================================
 *
 * The specification is explicit that generated text looking right is not proof.
 * This suite sends the writer's own output through the application's TikZ
 * service (TikZJax) and reads the SVG that comes back - so "the arrow is a line
 * with a small head" is checked against the COMPILED picture, not against the
 * string that was written.
 *
 * WHAT IS CHECKED
 *
 *   - the block compiles at all;
 *   - it draws TWO things: an open path (the shaft) and a closed one (the head);
 *   - the shaft is longer than the head, in the picture's own coordinates;
 *   - a filled head is still a small head, never the whole arrow;
 *   - reversing flips the head to the other end of the shaft.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { bootApp } = require("./helpers/boot-app.cjs");
const { locate } = require("./helpers/source-path.cjs");

test.after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});

let page = null;

function ready() {
  if (!page) {
    page = bootApp();

    if (page.error) {
      throw page.error;
    }
  }

  return page;
}

function modules() {
  ready();

  const state = require(locate("editor-state.js")).drawingState;

  return {
    state,
    ds: require(locate("drawing-state.js")).default,
    arrow: require(locate("model/fluids/flow-arrow.js")).default,
    sync: require(locate("source-synchronization.js")),
    schema: require(locate("feature-schema.js"))
  };
}

let renderer = null;

async function render(block) {
  if (!renderer) {
    renderer = await import("../server/tikz.js");
    await renderer.loadTikz();
  }

  return renderer.renderTikz(`\\begin{tikzpicture}[x=1mm, y=1mm]\n${block}\n\\end{tikzpicture}`);
}

/* One run from (0,0) to (100,0), with one arrow on it. */
function withArrow(fraction = 0.5) {
  const m = modules();

  m.state.objects = [];
  m.state.camera.zoom = 1;

  const created = m.ds.createGeometryObject("pipe-duct", {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 }
  });

  m.ds.addObject(m.state, created);

  const host = m.state.objects.find((object) => object.id === created.id);

  const arrow = m.arrow.createFlowArrow(host.id, { fraction });

  m.ds.addObject(m.state, arrow);

  return { ...m, host, arrow: m.state.objects.find((object) => object.id === arrow.id) };
}

/*
 * THE PICTURE'S SUBPATHS, AS POINT LISTS.
 *
 * TikZ compiles the whole picture's strokes into ONE `<path>` whose `d` holds a
 * SUBPATH per `\draw` - each begins with `M`. The arrow is therefore read as
 * two subpaths: the shaft (a move and a line) and the head (a move, two lines
 * and a close). Splitting on `M` is what separates them.
 *
 * Absolute commands only. The renderer emits `h`, `l`, `v` and `Z` as well, so
 * a relative `h`/`v` is resolved against the current point rather than being
 * read as a coordinate pair.
 */
function pathsOf(svg) {
  const read = (d) => {
    /*
     * THE NUMBER PATTERN MUST NOT SWALLOW THE SIGN OF THE NEXT ONE. SVG here is
     * written without separators (`-71.67-65.695` is two numbers), so each value
     * is read as an optional `-` followed by digits - never as `-?` repeated
     * across a boundary.
     */
    /*
     * ONE TOKEN PER COMMAND OR NUMBER, WITH ITS OWN SIGN. The digits and a
     * leading `-` are matched TOGETHER, so `-71.67-65.695` is two negative
     * values rather than one value and a stray dash.
     */
    const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];

    const points = [];
    let command = null;
    let current = { x: 0, y: 0 };
    let closed = false;

    /*
     * THE CURSOR IS EXPLICIT. `read1`/`read2` advance it, and the loop continues
     * from wherever they stopped - a closure over the loop variable would not
     * carry the advance back, and every relative command would then be read as
     * absolute.
     */
    let at = 0;

    const read1 = () => Number(tokens[at++]);

    const read2 = () => ({ x: read1(), y: read1() });

    while (at < tokens.length) {
      const token = tokens[at];

      if (/^[A-Za-z]$/.test(token)) {
        command = token;

        if (/[Zz]/.test(token)) {
          closed = true;
        }

        at += 1;
        continue;
      }

      /* A LOWER-CASE command is relative; an upper-case one is absolute. */
      const relative = /[a-z]/.test(command || "");

      if (/[MmLl]/.test(command)) {
        const delta = read2();

        current = relative ? { x: current.x + delta.x, y: current.y + delta.y } : delta;
      } else if (/[Hh]/.test(command)) {
        const delta = read1();

        current = { x: relative ? current.x + delta : delta, y: current.y };
      } else if (/[Vv]/.test(command)) {
        const delta = read1();

        current = { x: current.x, y: relative ? current.y + delta : delta };
      } else if (/[CcSsQqTtAa]/.test(command)) {
        /* Not produced by an arrow, but skip its arguments rather than misread. */
        at += /[CcAa]/.test(command) ? 6 : 4;
        continue;
      } else {
        at += 1;
        continue;
      }

      points.push(current);
    }

    return { d, points, closed: closed || /[Zz]\s*$/.test(d.trim()) };
  };

  /*
   * SPLIT ON EVERY `M`, WHEREVER IT FALLS. The renderer writes `h51.215M-3.384`
   * with no separator, so a split that expects whitespace would leave the
   * second subpath glued to the first and the two would be read as one path.
   */
  return [...svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)]
    .flatMap((match) => match[1].split(/M/).filter((part) => part.trim()))

    /* Every part IS a subpath, so each begins at a move - whatever was in front. */
    .map((part) => read(`M${part}`));
}

/*
 * The longest straight side of a path.
 *
 * For an OPEN path only the segments between consecutive points count - the
 * wrap-around would join the tail to the tip, which is not a side at all. For a
 * CLOSED path the wrap-around IS the last side.
 */
function longestEdge(points, { closed = true } = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    return 0;
  }

  let longest = 0;

  const sides = closed ? points.length : points.length - 1;

  for (let index = 0; index < sides; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];

    if (!point || !next) {
      continue;
    }

    longest = Math.max(longest, Math.hypot(next.x - point.x, next.y - point.y));
  }

  return longest;
}

test("R1: the arrow compiles to a line and a separate, closed head", async () => {
  const m = withArrow(0.5);
  const svg = await render(m.sync.sourceForObject(m.arrow));

  assert.ok(typeof svg === "string" && svg.includes("<svg"), "the arrow compiled to a picture");

  const paths = pathsOf(svg);

  const closed = paths.filter((path) => path.closed);
  const open = paths.filter((path) => !path.closed);

  /*
   * THE SHAFT. TikZ may compile two short segments into one path or into a
   * `line`, so both forms are accepted - but there must BE a long stroke.
   */
  const strokes = [
    ...open.map((path) => longestEdge(path.points, { closed: false })),
    ...[...svg.matchAll(/<line\b[^>]*>/g)].map((match) => {
      const tag = match[0];
      const x1 = Number((tag.match(/\bx1="([^"]*)"/) || [])[1]);
      const y1 = Number((tag.match(/\by1="([^"]*)"/) || [])[1]);
      const x2 = Number((tag.match(/\bx2="([^"]*)"/) || [])[1]);
      const y2 = Number((tag.match(/\by2="([^"]*)"/) || [])[1]);

      return Math.hypot(x2 - x1, y2 - y1);
    })
  ].filter(Number.isFinite);

  const shaft = Math.max(...strokes, 0);

  assert.ok(shaft > 0, "the arrow must draw a shaft line");

  /* THE HEAD: exactly one closed, three-cornered path. */
  assert.equal(closed.length, 1, `the head must be one closed path, found ${closed.length}`);

  const head = closed[0];

  assert.ok(head.points.length >= 3, "the head is a triangle");

  const headLength = Math.max(
    longestEdge(head.points),
    Math.hypot(head.points[0].x - head.points[2].x, head.points[0].y - head.points[2].y)
  );

  /*
   * THE CORE ASSERTION: the shaft is visibly longer than the head. A solid
   * triangle standing in for the whole arrow would fail this - its only edge
   * would be the whole symbol.
   */
  assert.ok(
    shaft > headLength,
    `the shaft (${shaft}) must be visibly longer than the head (${headLength})`
  );
});

test("R2: a filled head is still small - it never becomes the whole arrow", async () => {
  const m = withArrow(0.5);

  m.schema.writeField(m.arrow, "arrowheadFill", true);

  const svg = await render(m.sync.sourceForObject(m.arrow));

  const paths = pathsOf(svg);
  const closed = paths.filter((path) => path.closed);

  /*
   * A FILLED HEAD IS ONE REGION AND TWO SUBPATHS: the `\fill` and the outline
   * `\draw` describe the SAME triangle, so the renderer emits it twice - once
   * solid, once stroked. What must never happen is a closed shape as large as
   * the whole arrow, so every closed subpath is measured below.
   */
  assert.ok(closed.length >= 1, "there is a closed head");

  /* Every closed subpath is the SAME small head - there is no second, larger one. */
  const headSizes = closed.map((path) => longestEdge(path.points));

  assert.ok(
    Math.max(...headSizes) === Math.min(...headSizes),
    `every closed shape must be the one head, got ${headSizes.join(", ")}`
  );

  /*
   * THE FILLED REGION IS THE HEAD. The renderer writes a filled shape as a path
   * with no stroke (`stroke="none"`) under the group's own fill colour, so
   * that - not a `fill="..."` attribute - is what a solid head looks like in
   * the compiled picture.
   */
  assert.ok(/<path\b[^>]*\bstroke="none"/.test(svg), "the head is filled");

  const shaft = [
    ...paths.filter((path) => !path.closed).map((path) => longestEdge(path.points, { closed: false })),
    ...[...svg.matchAll(/<line\b[^>]*>/g)].map((match) => {
      const tag = match[0];
      const x1 = Number((tag.match(/\bx1="([^"]*)"/) || [])[1]);
      const y1 = Number((tag.match(/\by1="([^"]*)"/) || [])[1]);
      const x2 = Number((tag.match(/\bx2="([^"]*)"/) || [])[1]);
      const y2 = Number((tag.match(/\by2="([^"]*)"/) || [])[1]);

      return Math.hypot(x2 - x1, y2 - y1);
    })
  ].filter(Number.isFinite);

  assert.ok(shaft.length, "the shaft is still drawn");
  assert.ok(
    Math.max(...shaft) > Math.max(...headSizes),
    "the filled head is still smaller than the shaft"
  );

  /*
   * AND THE HEAD IS PROPORTIONATE. The wrap-around of a triangle counts only
   * its sides, so the head's longest side is at most its tip-to-barb length -
   * a quarter of the arrow plus a little for the barbs' width. A triangle that
   * had swallowed the arrow would be far larger.
   */
  assert.ok(
    Math.max(...headSizes) < Math.max(...shaft),
    "the head can never be as large as the arrow"
  );
});

test("R3: the generated commands are supported by the renderer", async () => {
  const m = withArrow(0.4);

  m.schema.writeField(m.arrow, "lineType", "dashed");
  m.schema.writeField(m.arrow, "stroke", "#c81e3c");
  m.schema.writeField(m.arrow, "lineWidth", 2);
  m.schema.writeField(m.arrow, "arrowheadFill", true);

  const svg = await render(m.sync.sourceForObject(m.arrow));

  assert.ok(typeof svg === "string" && svg.includes("<svg"), "a fully-styled arrow compiles");
  assert.ok(!/error|undefined|NaN/i.test(svg.replace(/<[^>]*>/g, " ")), "and contains no error text");

  /* The appearance reached the picture. */
  assert.ok(/stroke-dasharray/.test(svg), "the dash pattern is rendered");
});

test("R4: reversing flips the head to the other end of the shaft", async () => {
  const m = withArrow(0.5);

  const forward = pathsOf(await render(m.sync.sourceForObject(m.arrow)));
  const forwardHead = forward.find((path) => path.closed);

  m.schema.writeField(m.arrow, "reverseDirection", true);

  const backward = pathsOf(await render(m.sync.sourceForObject(m.arrow)));
  const backwardHead = backward.find((path) => path.closed);

  assert.ok(forwardHead && backwardHead);

  const centroid = (points) => ({
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  });

  /* Model space: increasing x is towards the run's end. */
  const forwardX = Math.max(...forwardHead.points.map((point) => point.x));
  const backwardX = Math.max(...backwardHead.points.map((point) => point.x));

  const forwardCentroid = centroid(forwardHead.points);
  const backwardCentroid = centroid(backwardHead.points);

  assert.ok(
    forwardCentroid.x > backwardCentroid.x,
    `the head must move to the other end: ${forwardCentroid.x} vs ${backwardCentroid.x}`
  );

  void forwardX;
  void backwardX;

  /* And the pipe is untouched by the flip. */
  assert.ok(Math.abs(m.host.geometry.start.x) < 1e-9);
  assert.ok(Math.abs(m.host.geometry.end.x - 100) < 1e-9);
});

/*
 * ========================================================
 * G. THE ARROW ON THE CANVAS ITSELF
 * ========================================================
 *
 * R1-R4 prove the COMPILED picture is a shaft and a small head. They could not
 * catch the failure this section exists for: the canvas drawers built the arrow
 * correctly and then handed it back to a group that was never attached to the
 * picture, so the sheet showed no arrow at all - or, through the fall-through
 * path, a single closed shape.
 *
 * So these read the SVG the REAL renderer appends for the arrow's own feature
 * group. That is the element a student sees, and nothing else stands in for it.
 */

function canvasModules() {
  ready();

  return {
    state: require(locate("editor-state.js")).drawingState,
    ds: require(locate("drawing-state.js")).default,
    arrow: require(locate("model/fluids/flow-arrow.js")).default,
    schema: require(locate("feature-schema.js")),
    renderer: require(locate("renderer.js")).default,
    sync: require(locate("source-synchronization.js")),
    document: page.document
  };
}

/* A sheet with one run and one arrow, rendered as the canvas renders it. */
function drawOnCanvas(options = {}) {
  const m = canvasModules();

  m.state.objects = [];
  m.state.camera = { ...(m.state.camera || {}), zoom: 1 };

  const pipe = m.ds.createGeometryObject("pipe-duct", { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
  m.ds.addObject(m.state, pipe);

  const host = m.state.objects.find((object) => object.id === pipe.id);
  const created = m.arrow.createFlowArrow(host.id, { fraction: 0.5, ...options });

  m.ds.addObject(m.state, created);

  const arrow = m.state.objects.find((object) => object.id === created.id);

  const svg = m.document.createElementNS("http://www.w3.org/2000/svg", "svg");
  m.renderer.renderDrawing(m.state, svg);

  const group = [...svg.querySelectorAll("g")].find(
    (element) => element.getAttribute("data-feature-id") === arrow.id
  );

  return { ...m, host, arrow, group, svg };
}

/* A drawn `<line>`'s length, in screen pixels. */
function lineLength(element) {
  const x1 = Number(element.getAttribute("x1"));
  const y1 = Number(element.getAttribute("y1"));
  const x2 = Number(element.getAttribute("x2"));
  const y2 = Number(element.getAttribute("y2"));

  return Math.hypot(x2 - x1, y2 - y1);
}

/* The corners of a drawn closed `<path>`, as screen points. */
function pathCorners(element) {
  const d = element.getAttribute("d") || "";

  return [...d.matchAll(/-?(?:\d+\.?\d*|\.\d+)/g)]
    .map((match) => Number(match[0]))
    .reduce((points, value, index, numbers) => {
      if (index % 2 === 0 && index + 1 < numbers.length) {
        points.push({ x: value, y: numbers[index + 1] });
      }

      return points;
    }, []);
}

/* The arrow's own drawn parts: its shaft line and its closed head. */
function partsOf(group) {
  const lines = [...group.querySelectorAll("line")];
  const closed = [...group.querySelectorAll("path")].filter((path) => /z\s*$/i.test(path.getAttribute("d") || ""));

  return { lines, closed };
}

test("G1: the canvas draws the arrow as a shaft line with a separate, small head", () => {
  const m = drawOnCanvas();
  const parts = partsOf(m.group);

  assert.ok(m.group, "the arrow's group must be attached to the picture");

  /*
   * THE SHAFT. One thin stroke along the centreline - the longest line in the
   * group belongs to the arrow itself, so it is the shaft.
   */
  const shaft = Math.max(...parts.lines.map(lineLength), 0);

  assert.ok(shaft > 0, "the arrow must draw a shaft line on the canvas");

  /* THE HEAD: one closed shape, and NOT the whole arrow. */
  assert.equal(parts.closed.length, 1, `the head must be one closed shape, found ${parts.closed.length}`);

  const corners = pathCorners(parts.closed[0]);

  assert.ok(corners.length >= 3, "the head is a triangle");

  /* Its axial length: tip to the midpoint of the barbs. */
  const centroidX = corners.reduce((sum, point) => sum + point.x, 0) / corners.length;

  const tip = corners.reduce((best, point) =>
    Math.abs(point.x - centroidX) > Math.abs(best.x - centroidX) ? point : best
  );

  const barbs = corners.filter((point) => point !== tip);

  const headBase = {
    x: (barbs[0].x + barbs[1].x) / 2,
    y: (barbs[0].y + barbs[1].y) / 2
  };

  const headLength = Math.hypot(tip.x - headBase.x, tip.y - headBase.y);

  assert.ok(headLength > 0, "the head has a length of its own");

  /* THE CORE ASSERTION: the shaft is visibly longer than the head. */
  assert.ok(
    shaft > headLength * 2,
    `the shaft (${shaft}) must be visibly longer than the head (${headLength})`
  );

  /* And the head is a small multiple, not the arrow: at default size, a quarter. */
  assert.ok(
    Math.abs(headLength / (shaft + headLength) - 0.25) < 0.02,
    "the head is a quarter of the arrow, as the model draws it"
  );
});

test("G2: increasing the Arrow Size keeps a line and a head, never one solid triangle", () => {
  const sizes = [8, 24, 40, 80];

  const measured = sizes.map((size) => {
    const m = drawOnCanvas({ size });
    const parts = partsOf(m.group);

    const shaft = Math.max(...parts.lines.map(lineLength), 0);

    assert.equal(parts.closed.length, 1, `size ${size}: the head must be a single closed shape`);

    const corners = pathCorners(parts.closed[0]);
    const centroidX = corners.reduce((sum, point) => sum + point.x, 0) / corners.length;
    const tip = corners.reduce((best, point) =>
      Math.abs(point.x - centroidX) > Math.abs(best.x - centroidX) ? point : best
    );
    const barbs = corners.filter((point) => point !== tip);
    const headBase = { x: (barbs[0].x + barbs[1].x) / 2, y: (barbs[0].y + barbs[1].y) / 2 };
    const headLength = Math.hypot(tip.x - headBase.x, tip.y - headBase.y);

    assert.ok(shaft > headLength, `size ${size}: the shaft must be longer than the head`);
    assert.equal(corners.length, 3, `size ${size}: the head is three corners, not a filling of the arrow`);

    /* AN UNFILLED HEAD, because Arrowhead Fill is off: nothing is painted solid. */
    const filled = [...m.group.querySelectorAll("path")].filter(
      (path) => (path.getAttribute("fill") || "") !== "none"
    );

    assert.equal(filled.length, 0, `size ${size}: an unfilled arrow must paint no solid shape`);

    return { size, shaft, headLength };
  });

  /* The size control grows the whole symbol, shaft included. */
  for (let index = 1; index < measured.length; index += 1) {
    const previous = measured[index - 1];
    const current = measured[index];

    assert.ok(
      current.shaft > previous.shaft,
      `size ${current.size}: the shaft should grow with the arrow (${previous.shaft} -> ${current.shaft})`
    );

    assert.ok(
      current.headLength > previous.headLength,
      `size ${current.size}: the head should grow with the arrow too`
    );
  }

  /* At the largest size the head is still a quarter - not the whole symbol. */
  const largest = measured[measured.length - 1];

  assert.ok(
    largest.headLength / (largest.shaft + largest.headLength) < 0.3,
    `at size ${largest.size} the head is still proportionate (${largest.headLength} of ${largest.shaft})`
  );
});

test("G3: Arrowhead Fill fills only the small head", () => {
  const m = drawOnCanvas();
  const parts = partsOf(m.group);

  const beforeShaft = Math.max(...parts.lines.map(lineLength), 0);
  const beforeHead = pathCorners(parts.closed[0]);

  m.schema.writeField(m.arrow, "arrowheadFill", true);

  const svg = m.document.createElementNS("http://www.w3.org/2000/svg", "svg");
  m.renderer.renderDrawing(m.state, svg);

  const group = [...svg.querySelectorAll("g")].find(
    (element) => element.getAttribute("data-feature-id") === m.arrow.id
  );

  const after = partsOf(group);
  const shaft = Math.max(...after.lines.map(lineLength), 0);

  /* The shaft is untouched by the fill. */
  assert.ok(Math.abs(shaft - beforeShaft) < 1e-6, "the shaft is the same with the head filled");

  /*
   * THE FILLED SHAPE IS THE HEAD. It is the same three corners as the outline
   * and no larger, so it can never become a triangle standing in for the arrow.
   */
  const painted = [...group.querySelectorAll("path")].filter(
    (path) => (path.getAttribute("fill") || "") !== "none"
  );

  assert.ok(painted.length >= 1, "a filled head is painted");

  const paintedExtent = painted
    .flatMap(pathCorners)
    .reduce((widest, point) => Math.max(widest, Math.hypot(point.x, point.y)), 0);

  const headExtent = beforeHead.reduce((widest, point) => Math.max(widest, Math.hypot(point.x, point.y)), 0);

  assert.ok(paintedExtent <= headExtent + 1e-6, "the filled shape is no larger than the head itself");
  assert.ok(shaft > 0, "and the arrow still has a shaft");
});

test("G4: reversing flips the arrow on the canvas without touching the pipe", () => {
  const m = drawOnCanvas();

  const headCentre = (group) => {
    const corners = pathCorners(partsOf(group).closed[0]);

    return corners.reduce((sum, point) => sum + point.x, 0) / corners.length;
  };

  const forwardX = headCentre(m.group);

  m.schema.writeField(m.arrow, "reverseDirection", true);

  const svg = m.document.createElementNS("http://www.w3.org/2000/svg", "svg");
  m.renderer.renderDrawing(m.state, svg);

  const group = [...svg.querySelectorAll("g")].find(
    (element) => element.getAttribute("data-feature-id") === m.arrow.id
  );

  const backwardX = headCentre(group);

  /* Model x increases toward the run's end, so the head must move LEFT. */
  assert.ok(backwardX < forwardX, `the head must flip: ${forwardX} -> ${backwardX}`);

  /* The shaft flips with it - the arrow is one symbol. */
  assert.equal(partsOf(group).closed.length, 1, "the reversed arrow is still a shaft and one head");

  /* And the host is untouched. */
  const host = m.state.objects.find((object) => object.id === m.host.id);

  assert.ok(Math.abs(host.geometry.start.x) < 1e-9);
  assert.ok(Math.abs(host.geometry.end.x - 100) < 1e-9);
});

test("G5: the source and the model agree, in both directions and at every size", () => {
  const m = canvasModules();

  m.state.objects = [];
  m.state.camera = { ...(m.state.camera || {}), zoom: 1 };

  const pipe = m.ds.createGeometryObject("pipe-duct", { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
  m.ds.addObject(m.state, pipe);

  const host = m.state.objects.find((object) => object.id === pipe.id);

  const reader = require(locate("fluids-readers.js"));

  [8, 24, 80].forEach((size) => {
    [false, true].forEach((reversed) => {
      const created = m.arrow.createFlowArrow(host.id, { fraction: 0.5, size, reversed });
      m.ds.addObject(m.state, created);

      const written = m.sync.sourceForObject(created);
      const label = `size ${size}, ${reversed ? "reversed" : "forward"}`;

      /* TWO COMMANDS: the open shaft and the closed head. */
      const draws = [...written.matchAll(/\\draw\[[^\]]*\]/g)];

      assert.equal(draws.length, 2, `${label}: the block is a shaft and a head`);

      const shaftLine = written.split("\n").find((line) => /^\\draw\[/.test(line) && !/cycle/.test(line));

      assert.ok(shaftLine, `${label}: the shaft is written as an open path`);

      /* THE SHAFT IS LONGER THAN THE HEAD, in the written geometry. */
      const coordinates = (line) => [...line.matchAll(/\((-?[\d.]+),\s*(-?[\d.]+)\)/g)].map((match) => ({
        x: Number(match[1]),
        y: Number(match[2])
      }));

      const shaftPoints = coordinates(shaftLine);

      assert.equal(shaftPoints.length, 2, `${label}: the shaft has two ends`);

      const shaftLength = Math.hypot(
        shaftPoints[1].x - shaftPoints[0].x,
        shaftPoints[1].y - shaftPoints[0].y
      );

      const shape = m.arrow.flowArrowShape(created);

      assert.ok(shaftLength > shape.headLength, `${label}: the written shaft is longer than the head`);

      /* READ IT BACK: the size, the direction, and the host survive the round trip. */
      const attachment = m.arrow.attachmentOf(created);
      const read = reader.readFlowArrow(written, { previous: created });

      assert.ok(read, `${label}: the block is readable`);
      assert.equal(read.type, "flow-arrow", `${label}: it reads back as an arrow`);
      assert.equal(read.hostId, host.id, `${label}: attached to the same run`);
      assert.equal(read.reversed, attachment.reversed === true, `${label}: the direction survives`);
      assert.ok(
        Math.abs(read.size - size) < 0.5,
        `${label}: the size survives (wrote ${size}, read ${read.size})`
      );

      /* Clean up so the next case starts from one arrow. */
      m.state.objects = m.state.objects.filter((object) => object.id !== created.id);
    });
  });
});
