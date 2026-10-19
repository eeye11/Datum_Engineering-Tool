/* SVG renderer for the engineering drawing workspace. */
/*
 * ========================================================
 * THE SKETCH EDITOR
 * ========================================================
 *
 * The other half of the Analysis Editor. A Plot is entered as equations
 * and a Sketch is drawn by hand, and both are reached from the same place
 * - openAnalysisEditorFor - so a student who placed an SFD and a BMD works
 * the same dialog either way, in the mode their feature was created in.
 *
 * FOUR TOOLS, AND ONLY FOUR
 * ------------------------
 *
 * Select, Straight Line, Curve, Erase.
 *
 * The general Geometry toolbar is deliberately NOT offered here. It is
 * built for a drawing sheet, where a rectangle or a construction line is a
 * normal thing to want. Here the student is sketching the SHAPE of one
 * diagram, and offering them forty tools to do it makes the obvious one
 * harder to find. Everything the sketch needs - two points and a pen - is
 * on those four buttons, and a Rectangle would be a Line with one more
 * click.
 *
 * DRAWING IS ENGINEERING, NOT PIXELS
 * ---------------------------------
 *
 * A point is stored as an engineering (x, y) in the graph's own
 * coordinate system - x being the source body's longitudinal station, and
 * y the value on the vertical axis. The screen mapping happens once, when
 * the graph is drawn. A sketch made at one zoom therefore reads identically
 * at another, which is the only way it can be measured later.
 *
 * THE STUDENT NEVER TYPES A COORDINATE.
 *
 * They click, and the click is resolved through the same scale the
 * axes are drawn with. Exact values are still available - on the element
 * list, once something is selected - but they are a way of checking the
 * work, not a way of doing it. Asking someone to type "x = 250" to place
 * a point at 250 is a way of making the graph harder to use than it needs
 * to be.
 *
 * A VERTICAL LINE IS JUST A LINE.
 *
 * There is no Vertical Jump tool. A Straight Line whose ends share an x is
 * a vertical line, and it is stored as one, so nothing has to convert it
 * afterwards and there is no second thing to get wrong.
 *
 * APPLY IS ONE HISTORY STEP.
 *
 * Nothing here touches the document until Apply. The preview callback
 * shows the work on the sheet while it is being done, exactly as the Plot
 * editor does, so Cancel genuinely cancels.
 */
const SVG_NS = "http://www.w3.org/2000/svg"; // eslint-disable-line no-unused-vars -- namespace kept for future direct node creation

/*
 * The drawing frame.
 *
 * WIDER AND TALLER THAN THE PLOT EDITOR'S, because a sketch is read as a
 * SHAPE and the graph is its main workspace. The rectangle the axes are drawn
 * into is what the student actually reads, so making the dialog bigger without
 * making this bigger would only enlarge the frame around an unchanged graph.
 */
const WIDTH = 900;
const HEIGHT = 320;
const PAD = 18;

/*
 * THE BAND AT THE BOTTOM OF THE FRAME FOR THE X LABELS AND TICKS.
 *
 * Reserved rather than overlapped: the graph's geometry is scaled into the
 * frame MINUS this band, so a diagram sitting on the axis never lands on top
 * of the numbers that say what the axis means. It is a layout constant, the
 * same way PAD is, rather than a nudge applied when something happens to
 * collide.
 */
const LABEL_BAND = 26;

/*
 * THE MARGIN LEFT FOR THE Y LABELS, to the left of the y-axis.
 *
 * The y-axis is drawn just inside the frame's left edge, and its values are
 * right-aligned against it in this margin - so they are always outside the
 * plotting area and can never sit on the diagram.
 */
const Y_LABEL_MARGIN = 34;

const TOOLS = [
  { id: "select", label: "Select", hint: "Click an element to select it" },
  {
    id: "line",
    label: "Straight Line",
    hint: "Drag from the start to the end, then release",
  },
  {
    id: "curve",
    label: "Curve",
    hint: "Drag in three goes: Start, then Bend, then End",
  },
  { id: "erase", label: "Erase", hint: "Click an element to remove it" },
];

let openDialog = null;
let closeCurrent = null;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/*
 * A stable id for a new element.
 *
 * NOT the array position. An element identified by where it happens to
 * sit in a list cannot be renamed, re-selected or referenced after
 * anything above it is deleted - which is what makes "the wrong element
 * got deleted" possible at all.
 */
function newId(sequence) {
  return `sketch-${sequence}`;
}

function numberText(value) {
  if (!Number.isFinite(value)) {
    return "";
  }

  return String(Math.round(value * 1000) / 1000);
}

/*
 * ENGINEERING <-> SCREEN, AND WHY IT IS FIXED FOR THE SESSION.
 *
 * One function, used by everything that draws and everything that reads a
 * click, so the two can never disagree.
 *
 * THE Y SCALE IS CHOSEN ONCE AND DOES NOT CHANGE while the sketch is open.
 *
 * That is the whole of the "the geometry runs away from the mouse" defect.
 * The scale used to be derived from the CURRENT elements' height on every
 * redraw - so the moment a point was dragged upward, the peak grew, the
 * scale changed, and every point on the graph MOVED. The point under the
 * cursor was therefore never where the cursor was: the student aimed at a
 * spot, the graph rescaled beneath them, and the shape shot off. It is also
 * why the axes appeared to jump and why a sketch with nothing in it had an
 * arbitrary height.
 *
 * So the vertical extent comes from `chooseScale` below, which is called ONCE
 * for the session and then used unchanged. Adding, moving or deleting an
 * element cannot move the graph, and the mapping
 *
 *     mouse position -> graph coordinate -> drawn geometry
 *
 * is stable for as long as the editor is open.
 */
function makeScale(range, elements, options) {
  const from = Number(range?.from) || 0;
  const to = Number(range?.to) || 1;
  const span = to - from || 1;

  const plotLeft = PAD + Y_LABEL_MARGIN;
  const plotWidth = WIDTH - PAD - Y_LABEL_MARGIN;
  const plotHeight = HEIGHT - PAD * 2 - LABEL_BAND;
  const centre = PAD + plotHeight / 2;

  const unitHeight = chooseUnitHeight(range, elements, options);

  const halfHeight = (plotHeight / 2) * 0.92;

  return {
    toScreen(point) {
      return {
        x: plotLeft + ((point.x - from) / span) * plotWidth,
        y: centre - (point.y / unitHeight) * halfHeight,
      };
    },
    fromScreen(screen) {
      return {
        x: from + ((screen.x - plotLeft) / plotWidth) * span,
        y: ((centre - screen.y) / halfHeight) * unitHeight,
      };
    },
    unitHeight,

    /*
     * THE GEOMETRY OF THE FRAME, exposed so the axes and the snap helpers do
     * not each re-derive the same numbers. The right-hand margin and the label
     * band are part of the frame, not private arithmetic.
     */
    plot: {
      left: plotLeft,
      right: plotLeft + plotWidth,
      top: PAD,
      bottom: PAD + plotHeight,
      width: plotWidth,
      height: plotHeight,
      centre,
    },
    range: { from, to, span },
  };
}

/*
 * ========================================================
 * HOW TALL THE GRAPH IS, IN THE DIAGRAM'S OWN UNITS
 * ========================================================
 *
 * THE AXIS REACHES THE ACTUAL GEOMETRY, with a small readable margin.
 *
 * It used to be the largest ABSOLUTE value - `peak * 1.35` - which is a
 * different question and gave a different answer. `Math.abs` throws the SIGN
 * away, so a diagram drawn entirely BELOW the axis was measured by how far
 * above it something might have been, and the extent below was whatever that
 * number happened to be. A trough at -40 under a peak at -5 gave an axis 54
 * units long with 49 of them wasted.
 *
 * So the HIGHEST and LOWEST points are found separately, and the extent is the
 * larger of the two distances from the axis - which is what makes the graph
 * reach the extremum on BOTH sides without leaving a band of empty space on
 * the side nothing is drawn on.
 *
 * THE MARGIN IS SMALL AND PROPORTIONAL. `1.12` rather than `1.35`: the axis
 * reaches just past the geometry, so a label at the top is not sitting on the
 * curve, without the large fixed band of unused graph the old factor left. A
 * diagram that grows to touch its own axis is a diagram whose axis is the right
 * size.
 *
 * AND THE CURVE'S REAL EXTREMA ARE USED. A quadratic bulges BEYOND its control
 * points - the drawn curve is pulled toward the Bend, not through it - so
 * testing only the stored points can clip the top of a bow. `curveExtents`
 * solves for the curve's actual maximum and minimum.
 */
function chooseUnitHeight(range, elements, options) {
  const span = (Number(range?.to) || 1) - (Number(range?.from) || 0) || 1;

  const declared = Number(options?.yRange);

  let high = 0;
  let low = 0;

  elements.forEach((element) => {
    const extent = elementYExtent(element);

    high = Math.max(high, extent.high);
    low = Math.min(low, extent.low);
  });

  /*
   * ========================================================
   * THE AXIS REACHES WHAT IS DRAWN, NOT WHAT COULD BE DRAWN
   * ========================================================
   *
   * The extent is the ACTUAL geometry - the highest and lowest points of the
   * elements that are really on the graph - with a small margin. That is what
   * makes the axis fit the diagram the student drew: draw one small bump and
   * the axis reaches it; draw a tall spike and the axis grows to hold it; erase
   * the spike and the axis comes back down.
   *
   * THE ANALYSIS LAYER'S RANGE IS A FALLBACK, NOT A FLOOR.
   *
   * It used to be ORed into the extent, so a sketch with one small element - or
   * none at all - was still drawn against the full height of the body's
   * diagram. The axis then reached far beyond anything on the graph, which is
   * the "arbitrary fixed range" this fixes. It is used only when there is
   * NOTHING drawn, so an empty sketch still has a real y-axis to start against
   * rather than a degenerate one.
   */
  const drawnHigh = high;
  const drawnLow = low;

  const reach = Math.max(drawnHigh, Math.abs(drawnLow));

  if (reach > 0) {
    /*
     * A SMALL READABLE MARGIN, not a generous one. 12% of the drawn height is
     * enough that a peak does not touch the frame and its label has somewhere
     * to sit, and little enough that the graph is not padded with space the
     * student did not ask for.
     */
    return reach * 1.12;
  }

  /*
   * NOTHING DRAWN YET. The body's own diagram height, when the analysis layer
   * knows one, so an empty sketch is drawn to the scale its PLOTTED mode would
   * use - switching between drawing and plotting a diagram then shows it at one
   * size. Failing that, a real extent either side of the axis, so the y-axis,
   * its ticks and its labels exist before the first element is drawn.
   */
  if (Number.isFinite(declared) && declared > 0) {
    return declared * 1.12;
  }

  return Math.max(span * 0.25, 1);
}

/*
 * The highest and lowest y an element actually reaches.
 *
 * A LINE is its two ends. A `curve3` is a QUADRATIC, so its extremes are solved
 * for rather than read off the control points: the drawn curve is pulled toward
 * the Bend and does not pass through it, so the Bend's own y is neither the
 * curve's highest nor its lowest point - using it would reserve space for a bow
 * the student never sees, or clip one they do.
 *
 * A legacy many-point curve is sampled along its segments, because it is drawn
 * as a chain of quadratics between the midpoints of consecutive points. Those
 * midpoints are the visible extremes, so they are what is measured.
 */
function elementYExtent(element) {
  let high = -Infinity;
  let low = Infinity;

  const see = (value) => {
    if (Number.isFinite(value)) {
      high = Math.max(high, value);
      low = Math.min(low, value);
    }
  };

  if (element?.kind === "curve3") {
    const { start, bend, end } = element;

    if (start && bend && end) {
      /*
       * A QUADRATIC BEZIER'S EXTREMA.
       *
       * B(t) = (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2, so dB/dt = 0 at
       * t = (P0 - P1) / (P0 - 2P1 + P2). Evaluated at that t, when it lies
       * within the segment, gives the curve's own extreme y.
       */
      see(start.y);
      see(end.y);

      const denominator = start.y - 2 * bend.y + end.y;

      if (Math.abs(denominator) > 1e-12) {
        const t = (start.y - bend.y) / denominator;

        if (t > 0 && t < 1) {
          const oneMinus = 1 - t;

          see(
            oneMinus * oneMinus * start.y +
              2 * oneMinus * t * bend.y +
              t * t * end.y,
          );
        }
      }
    }

    return { high: high === -Infinity ? 0 : high, low: low === Infinity ? 0 : low };
  }

  pointsOf(element).forEach((point) => see(point.y));

  return {
    high: high === -Infinity ? 0 : high,
    low: low === Infinity ? 0 : low,
  };
}

/*
 * ========================================================
 * BUILD ONE CURVE FROM THREE POINTS
 * ========================================================
 *
 * The whole curve vocabulary in one function. Start and End are the ends of
 * the drawn curve; Bend is the control point that says how far and which way
 * it bows:
 *
 *   Bend on the Start-End line          -> a straight-ish segment
 *   Bend above it                       -> a rise into a peak
 *   Bend below it                       -> a fall into a trough
 *   Bend to one side of a rise          -> concave up or concave down
 *
 * There is deliberately no per-shape tool. The student places three points,
 * and the renderer draws a quadratic whose control IS the Bend - which gives
 * every one of increasing, decreasing, extremal and concave shapes from the
 * one tool.
 */
function buildThreePointCurve(id, start, bend, end) {
  return {
    id,
    kind: "curve3",
    start: { x: start.x, y: start.y },
    bend: { x: bend.x, y: bend.y },
    end: { x: end.x, y: end.y },
  };
}

/*
 * The points an element is drawn through.
 *
 * A LINE has two and a CURVE has as many as were clicked. Reading them
 * through one function means the scale above does not have to know which
 * kind of element it is looking at, and adding a kind later touches one
 * place.
 */
function pointsOf(element) {
  if (!element) {
    return [];
  }

  /*
   * A THREE-POINT CURVE reports Start, Bend and End. The Bend is included so
   * the vertical scale makes room for the bulge it describes - a peak drawn
   * by bending would otherwise run off the top of the graph.
   */
  if (element.kind === "curve3") {
    return [element.start, element.bend, element.end].filter(
      (point) => point && Number.isFinite(point.x),
    );
  }

  return element.kind === "line"
    ? [element.start, element.end]
    : Array.isArray(element.points)
      ? element.points
      : [];
}

/*
 * THE GRAPH.
 *
 * The same axes the Plot editor draws, plus the sketch on top. Sharing
 * the shape rather than reimplementing it is what stops the two modes
 * from looking like two different applications.
 */
function drawGraph(svg, elements, range, options) {
  if (!svg) {
    return null;
  }

  const selectedId = options?.selectedId || null;

  /*
   * THE SCALE IS HANDED IN, not derived here.
   *
   * It used to be built inside this function, from the elements it was about
   * to draw - which is what made the graph rescale itself the moment a point
   * moved. The editor now chooses it ONCE and passes the same one every time,
   * so nothing a gesture does can change the mapping between the cursor and
   * the drawing. `makeScale` is still the fallback for a caller that has no
   * scale to give (a test, or a one-off render).
   */
  const scale = options?.scale || makeScale(range, elements, options);
  const plot = scale.plot;

  const axisY = scale.toScreen({ x: 0, y: 0 }).y;

  const parts = [];

  /*
   * ========================================================
   * THE AXES ARE DRAWN FIRST, AND ALWAYS
   * ========================================================
   *
   * BOTH of them, whether or not the sketch has anything in it. An empty
   * sketch is still a graph, and an empty graph with no axes tells the student
   * nothing about where to draw - which is exactly when they need the axes
   * most.
   *
   * The X axis sits at y = 0 in the graph's own units (so it moves when the
   * diagram grows downward, which is correct - a sagging diagram is below its
   * axis), and the Y axis is pinned to the plot's left edge. The y-axis is a
   * REFERENCE, not a line at x = 0: for a diagram whose range starts at a
   * support, x = 0 would sit on top of the left margin.
   */
  parts.push(`
      <line class="sketch-editor-axis"
        x1="${plot.left}" y1="${axisY}"
        x2="${plot.right}" y2="${axisY}"/>

      <line class="sketch-editor-axis"
        x1="${plot.left}" y1="${plot.top}"
        x2="${plot.left}" y2="${plot.bottom}"/>
    `);

  /*
   * ========================================================
   * THE X TICKS AND THEIR VALUES
   * ========================================================
   *
   * Every tick gets a short mark ACROSS the axis and a NUMBER BENEATH IT, in
   * the reserved label band. The numbers are why the band exists: they are the
   * only thing that says what a station is, and a diagram you cannot read the
   * scale of is not a diagram.
   *
   * They are drawn after the axis so they sit on top of it, and their text is
   * ANCHORED to the middle of their own tick - so two adjacent stations label
   * themselves where they are rather than drifting apart.
   */
  const stations = Array.isArray(options?.stations) ? options.stations : [];

  stations.forEach((station) => {
    const x = Number(station?.position?.x);

    if (!Number.isFinite(x)) {
      return;
    }

    const screenX = scale.toScreen({ x, y: 0 }).x;

    parts.push(`
        <line class="sketch-editor-tick"
          x1="${screenX}" y1="${plot.top}"
          x2="${screenX}" y2="${plot.bottom}"/>

        <line class="sketch-editor-axis-mark"
          x1="${screenX}" y1="${axisY - 4}"
          x2="${screenX}" y2="${axisY + 4}"/>

        <text class="sketch-editor-tick-label"
          x="${screenX}" y="${plot.bottom + 14}"
          text-anchor="middle">${escapeHtml(
            numberText(x),
          )}</text>
      `);
  });

  /*
   * ========================================================
   * THE Y TICKS AND THEIR VALUES
   * ========================================================
   *
   * Scaled from the same fixed extent the geometry uses, so a value on the
   * axis is the value a point at that height actually has. Five marks - the
   * two extremes, zero, and the halfway points - which is enough to read a
   * diagram against without turning the margin into a ruler.
   *
   * THEY LIVE IN THE LEFT MARGIN, right-aligned against the y-axis, so they
   * can never overlap the drawing however tall it gets.
   */
  const yStep = scale.unitHeight;

  [yStep, yStep / 2, 0, -yStep / 2, -yStep].forEach((value) => {
    const screenY = scale.toScreen({ x: 0, y: value }).y;

    if (screenY < plot.top - 2 || screenY > plot.bottom + 2) {
      return;
    }

    parts.push(`
        <line class="sketch-editor-axis-mark"
          x1="${plot.left - 4}" y1="${screenY}"
          x2="${plot.left}" y2="${screenY}"/>

        <text class="sketch-editor-axis-label"
          x="${plot.left - 7}" y="${screenY + 3}"
          text-anchor="end">${escapeHtml(numberText(value))}</text>
      `);
  });

  elements.forEach((element) => {
    const pts = pointsOf(element);

    if (pts.length < 2) {
      return;
    }

    const screen = pts.map((p) => scale.toScreen(p));
    const selected = element.id === selectedId;
    const cls = selected
      ? "sketch-editor-stroke sketch-editor-stroke-selected"
      : "sketch-editor-stroke";

    if (element.kind === "line") {
      parts.push(`
          <line class="${cls}"
            x1="${screen[0].x}" y1="${screen[0].y}"
            x2="${screen[1].x}" y2="${screen[1].y}"/>
        `);
      return;
    }

    /*
     * ========================================================
     * A THREE-POINT CURVE: START -> BEND -> END
     * ========================================================
     *
     * ONE smooth curve from three meaningful points. The Start and End are the
     * curve's ends; the Bend is a CONTROL point that says how far and which way
     * the curve bows, and it is drawn as a quadratic whose control is the Bend
     * itself - so pulling the Bend out makes the bow stronger, and putting it
     * above or below the Start-End line turns the same tool into a peak or a
     * trough.
     *
     * The Bend is a control point, not a vertex of the result: the drawn curve
     * passes through the Start and the End and is pulled toward the Bend, which
     * is what makes one tool cover increasing, decreasing, concave and extremal
     * shapes without a separate tool for each.
     */
    if (element.kind === "curve3") {
      const s = scale.toScreen(element.start);
      const b = scale.toScreen(element.bend || element.start);
      const e = scale.toScreen(element.end);

      parts.push(`
          <path class="${cls}"
            d="M ${s.x} ${s.y} Q ${b.x} ${b.y} ${e.x} ${e.y}"/>
        `);

      /*
       * THE CONTROL POINTS ARE DRAWN ONCE, by the handle pass below - so the
       * Start, the Bend and the End all behave the same way and there is no
       * second place that decides where a point is.
       */
      return;
    }

    /*
     * A CURVE IS ONE ELEMENT WITH MANY POINTS, NOT MANY LINES.
     *
     * Drawn as a quadratic through the midpoints of consecutive control
     * points rather than through the points themselves: that passes
     * through none of them, so the student cannot tell where the shape
     * they drew ended and the curve began. A Catmull-Rom spline would
     * pass through them and overshoot sharply between them - the
     * characteristic overshoot that makes an auto-smoothed curve look
     * wrong on the very shape it was drawn for.
     */
    const d = [`M ${screen[0].x} ${screen[0].y}`];

    for (let i = 1; i < screen.length - 1; i++) {
      const mid = {
        x: (screen[i].x + screen[i + 1].x) / 2,
        y: (screen[i].y + screen[i + 1].y) / 2,
      };

      d.push(`Q ${screen[i].x} ${screen[i].y} ${mid.x} ${mid.y}`);
    }

    const last = screen[screen.length - 1];

    d.push(`L ${last.x} ${last.y}`);

    parts.push(`<path class="${cls}" d="${d.join(" ")}"/>`);
  });

  /*
   * THE PEN IN PROGRESS.
   *
   * Drawn while the student is mid-stroke, so the shape they are about
   * to get is visible before they commit to it. Without this, a curve
   * of four points shows only the first two until it is finished, and
   * there is no way to see that a click landed where they meant.
   */
  const pending = options?.pending || null;

  if (pending && pending.points.length) {
    const screen = pending.points.map((p) => scale.toScreen(p));

    if (screen.length === 1) {
      parts.push(
        `<circle class="sketch-editor-cursor-point"
            cx="${screen[0].x}" cy="${screen[0].y}" r="3"/>`,
      );
    } else {
      parts.push(`
          <path class="sketch-editor-pending" d="M ${screen
            .map((p) => `${p.x} ${p.y}`)
            .join(" L ")}"/>
        `);
    }
  }

  /*
   * THE ELEMENT'S OWN CONTROL POINTS, while it is selected.
   *
   * Every point an element is defined by is draggable directly, so the student
   * edits the SHAPE rather than typing at it. They are drawn only for the
   * selection, because they are an editing aid and not part of the diagram.
   */
  const selectedElement =
    elements.find((element) => element.id === selectedId) || null;

  if (selectedElement) {
    selectedElementPoints(selectedElement).forEach((entry) => {
      const screen = scale.toScreen(entry.point);

      parts.push(`
          <circle class="sketch-editor-handle"
            data-handle-kind="${escapeHtml(entry.kind)}"
            data-handle-index="${entry.index}"
            cx="${screen.x}" cy="${screen.y}" r="4.5"/>
        `);
    });
  }

  /*
   * THE SNAP INDICATION.
   *
   * A small ring on the point the placement will actually use, drawn in the
   * application's snap colour, plus the kind of thing it caught. It is the
   * same language the main canvas uses for a snap, so the sketch's magnet reads
   * the same way the drawing's does - one application, one convention.
   *
   * It is drawn AFTER the elements so it is never hidden behind the stroke it
   * is landing on, and it disappears the moment the cursor leaves the snap
   * because the caller clears the state.
   */
  const snap = options?.activeSnap || null;

  if (snap && snap.point) {
    const at = scale.toScreen(snap.point);

    parts.push(`
        <circle class="sketch-editor-snap"
          cx="${at.x}" cy="${at.y}" r="5"/>

        <text class="sketch-editor-snap-label"
          x="${at.x + 8}" y="${at.y - 7}">${escapeHtml(
            snapLabel(snap.kind),
          )}</text>
      `);
  }

  /*
   * THE FRAME'S OWN LABELS: what the two ends of the x range are, ONCE, at the
   * bottom of the graph. The per-station numbers above say where each tick is;
   * these say what the axis as a whole spans, which is the thing a reader
   * looks for when the ticks are dense.
   */
  parts.push(`
      <text x="${plot.left}" y="${HEIGHT - 4}" class="sketch-editor-label">
        ${escapeHtml(numberText(Number(range?.from) || 0))}
      </text>
      <text x="${plot.right}" y="${HEIGHT - 4}"
        class="sketch-editor-label" text-anchor="end">
        ${escapeHtml(numberText(Number(range?.to) || 0))}
      </text>
    `);

  svg.innerHTML = parts.join("");

  return scale;
}

/*
 * ========================================================
 * THE POINTS AN ELEMENT CAN BE EDITED BY
 * ========================================================
 *
 * One list, in one order, used by the HANDLES the student sees and by the HIT
 * TEST that decides which one they grabbed - so a handle can never be drawn
 * somewhere the drag does not look for it.
 *
 * A line has its two ends AND a middle handle. A three-point curve has its
 * Start, its Bend and its End - all three, because the Bend is the whole point
 * of the tool and dragging it is how a curve is shaped. A legacy many-point
 * curve exposes every point it was drawn through.
 *
 * THE LINE'S MIDDLE HANDLE IS HOW A LINE BECOMES A CURVE.
 *
 * A student often knows the two ends first and only then wants the middle to
 * bow - a moment diagram is a parabola between two known values. Requiring them
 * to delete the line and redraw it as a curve throws away the endpoints they
 * already placed, so the middle handle BENDS it instead: dragging it converts
 * the line into a `curve3` whose Start and End are untouched and whose Bend is
 * wherever they dragged.
 */
function selectedElementPoints(element) {
  if (!element) {
    return [];
  }

  if (element.kind === "line") {
    return [
      { kind: "start", index: 0, point: element.start },

      /*
       * THE MIDDLE HANDLE. It sits at the midpoint of the line, so it is
       * exactly where a straight line's control point belongs - on the line,
       * meaning "not bent yet". Dragging it off the line IS the bend.
       */
      { kind: "bend", index: 1, point: lineMidpoint(element) },

      { kind: "end", index: 2, point: element.end },
    ].filter((entry) => entry.point);
  }

  if (element.kind === "curve3") {
    return [
      { kind: "start", index: 0, point: element.start },
      { kind: "bend", index: 1, point: element.bend },
      { kind: "end", index: 2, point: element.end },
    ].filter((entry) => entry.point);
  }

  return (element.points || []).map((point, index) => ({
    kind: "point",
    index,
    point,
  }));
}

/*
 * The midpoint of a straight element - where its bend handle sits.
 */
function lineMidpoint(element) {
  if (!element?.start || !element?.end) {
    return null;
  }

  return {
    x: (element.start.x + element.end.x) / 2,
    y: (element.start.y + element.end.y) / 2,
  };
}

/*
 * HOW NEAR IS THIS CLICK TO THAT ELEMENT?
 *
 * In SCREEN pixels, because what the student is aiming at is what they
 * can see. The comparison is made after projection so it respects the
 * current scale - a point that is visually on the line is on the line.
 */
function distanceToElement(screen, element, scale) {
  const pts = pointsOf(element).map((p) => scale.toScreen(p));

  if (pts.length < 2) {
    return pts.length === 1
      ? Math.hypot(
          screen.x - pts[0].x,
          screen.y - pts[0].y,
        )
      : Infinity;
  }

  let best = Infinity;

  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(
      best,
      distanceToSegment(screen, pts[i], pts[i + 1]),
    );
  }

  return best;
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;

  t = Math.max(0, Math.min(1, t));

  return Math.hypot(
    p.x - (a.x + t * dx),
    p.y - (a.y + t * dy),
  );
}

function elementAt(screen, elements, scale) {
  let best = null;
  let bestDistance = Infinity;

  elements.forEach((element) => {
    const distance = distanceToElement(screen, element, scale);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = element;
    }
  });

  /*
   * A tolerance, so a click near an element selects it. It is a
   * SCREEN distance on purpose: the student is aiming with a mouse at
   * something they can see, and a tolerance expressed in millimetres
   * would be far too tight at one zoom and far too loose at another.
   */
  return bestDistance <= 8 ? best : null;
}

/*
 * ========================================================
 * WHERE THE POINTER IS, IN THE GRAPH'S OWN COORDINATES
 * ========================================================
 *
 * ONE conversion, used by every gesture: the press that arms a stroke, the
 * move that drags its end, the click that places the second point, and the
 * drag of a handle. Because they all read the pointer through here, they cannot
 * disagree about where the cursor is - which is what "the geometry follows the
 * mouse" reduces to.
 *
 * The conversion is `scale.fromScreen`, the exact inverse of the `toScreen`
 * the axes and every element are drawn with. There is NO offset applied here
 * and none anywhere else: an offset would have to be tuned per zoom and would
 * be wrong the moment the frame changed size.
 */
/*
 * ========================================================
 * WHERE THE CURSOR IS, IN THE GRAPH'S OWN COORDINATES
 * ========================================================
 *
 * THE BUG THIS FIXES. The graph SVG carries a `viewBox` of 0 0 900 320 and is
 * laid out with `width: 100%`, so the browser SCALES the viewBox to whatever
 * width the panel happens to be and centres it vertically (`xMidYMid meet`).
 *
 * The old code did this:
 *
 *     x: event.clientX - rect.left,
 *     y: event.clientY - rect.top,
 *
 * which is a position in RENDERED PIXELS. But `scale.fromScreen` maps from
 * VIEWBOX UNITS - the 0..WIDTH, 0..HEIGHT space the graph is drawn in. The two
 * only agree when the SVG is displayed at exactly 900x320, which it almost
 * never is: the panel is a flexible width and the element is `width: 100%`.
 *
 * So every click and every pointer move was converted through the wrong space,
 * and the error grew with the difference - which is exactly "the line being
 * drawn is not aligned with the cursor", and why it was worse in a narrower
 * panel. It also explains the letterboxing: `meet` centres the drawing, adding
 * a VERTICAL offset that a rect-relative subtraction cannot see at all.
 *
 * SO THE OFFSET IS SCALED INTO VIEWBOX UNITS, letterbox included. The ratio and
 * the centring are read from the element's own rect and the viewBox it declares,
 * so this holds for any panel width, any zoom and either aspect arrangement.
 *
 * A single ratio and two offsets, applied to the raw client point - the same
 * arithmetic the SVG's own `getScreenCTM()` performs, written out because the
 * editor also runs in a test harness where the CTM is not available.
 */
function clientToViewBox(event, svg) {
  const rect = svg.getBoundingClientRect
    ? svg.getBoundingClientRect()
    : { left: 0, top: 0, width: WIDTH, height: HEIGHT };

  /*
   * THE DECLARED VIEWBOX, or the editor's own canvas when there is none.
   * `viewBox.baseVal` is the parsed form; the attribute is the fallback for a
   * DOM that does not implement it.
   */
  const declared =
    svg.viewBox?.baseVal && svg.viewBox.baseVal.width
      ? svg.viewBox.baseVal
      : null;

  const boxWidth = Number(declared?.width) || WIDTH;
  const boxHeight = Number(declared?.height) || HEIGHT;

  const renderedWidth = Number(rect.width) || boxWidth;
  const renderedHeight = Number(rect.height) || boxHeight;

  /*
   * `meet` fits the viewBox INSIDE the element, keeping its shape - so the
   * scale is the SMALLER of the two ratios, and the leftover space is shared
   * equally on each side of whichever axis has room.
   */
  const ratio = Math.min(
    renderedWidth / boxWidth,
    renderedHeight / boxHeight,
  );

  const drawnWidth = boxWidth * ratio;
  const drawnHeight = boxHeight * ratio;

  const offsetLeft = (renderedWidth - drawnWidth) / 2;
  const offsetTop = (renderedHeight - drawnHeight) / 2;

  return {
    x: (event.clientX - rect.left - offsetLeft) / ratio,
    y: (event.clientY - rect.top - offsetTop) / ratio,
  };
}

function pointFromEvent(event, svg, scale) {
  return scale.fromScreen(clientToViewBox(event, svg));
}

/*
 * What a snap calls itself, in the graph's own words.
 *
 * The two INFERENCE kinds are named as the constraint they are - Horizontal
 * and Vertical - because a student who is shown "Horizontal" knows their two
 * points will share a y, whereas a generic "snap" tells them nothing about
 * what the geometry is going to be.
 */
function snapLabel(kind) {
  return (
    {
      endpoint: "Endpoint",
      station: "Station",
      horizontal: "Horizontal",
      vertical: "Vertical",
    }[kind] || "Snap"
  );
}

/*
 * ========================================================
 * SNAPPING
 * ========================================================
 *
 * Three things worth landing on, and one rule for all of them:
 *
 *   1. THE BODY'S X TICKS - a diagram changes shape under a force, at a
 *      support, where a load starts, and those stations are what a diagram is
 *      read against.
 *
 *   2. VERTICAL ALIGNMENT WITH A TICK - the x alone is pulled, so a point
 *      ABOVE a station lines up with it while keeping whatever height the
 *      cursor is at. Snapping the y too would drag the point onto the axis,
 *      which is a different thing and not what "line it up with that station"
 *      means.
 *
 *   3. ANOTHER ELEMENT'S ENDPOINTS - so a diagram can be drawn station by
 *      station, each segment starting exactly where the last one finished,
 *      which is what makes a stepped or sloped profile come out closed.
 *
 * THE SNAP IS A MAGNET WITHIN A FEW PIXELS, never a wall: the tolerance is in
 * SCREEN pixels so it feels identical at any scale, and outside it the cursor
 * is free. A snap that captured the whole gap would make the middle of every
 * span unreachable, and the interesting part of a curve is usually between the
 * ticks.
 */
const SNAP_TOLERANCE_PX = 8;

/*
 * One screen pixel, in each graph unit. The two axes have different scales, so
 * they get different factors - using one for both would make the snap twice as
 * sticky vertically as horizontally, or the reverse.
 */
function snapTolerances(scale) {
  return {
    x: (scale.range.span / scale.plot.width) * SNAP_TOLERANCE_PX,
    y: (scale.unitHeight / (scale.plot.height * 0.92)) * SNAP_TOLERANCE_PX,
  };
}

/*
 * Snap a graph point, and say WHAT it snapped to.
 *
 * Returning the kind is what lets the editor show the DAETUM snap indication -
 * the same "endpoint"/"station" feedback the canvas gives - so a student can
 * tell a snapped placement from a free one instead of having to guess.
 */
function snapPoint(point, context) {
  const { scale, stations, elements, excludeId, from } = context;

  const tolerance = snapTolerances(scale);

  /*
   * ========================================================
   * HORIZONTAL AND VERTICAL INFERENCE, FROM THE LAST POINT
   * ========================================================
   *
   * A diagram is drawn between values it already knows - a step at the same
   * height, a jump at the same station - so the FIRST thing a student wants
   * after placing a point is to move straight across from it or straight up.
   *
   * THIS IS A CONSTRAINT, NOT A LOOK. `from` is the point the stroke is
   * working from, and when the cursor is within tolerance of one of its axes
   * the matching coordinate is set to `from`'s EXACT value - not to a rounded
   * one, and not merely drawn as though aligned. A step that looks horizontal
   * and stores y = 40.03 against y = 40 is a defect the renderer hides and the
   * analysis finds.
   *
   * IT IS CHECKED BEFORE THE STATION SNAP, because it uses a point the student
   * has ALREADY placed and is therefore more specific than a station derived
   * from the body. Between the two, the one the student is working from wins.
   *
   * A SQUARE KEEP-OUT around `from` hands the endpoint snap back: within that
   * box the cursor is near the point itself, and a student there means the
   * point, not an axis through it.
   */
  if (from && Number.isFinite(from.x) && Number.isFinite(from.y)) {
    const dx = point.x - from.x;
    const dy = point.y - from.y;

    const nearThePoint =
      Math.abs(dx) <= tolerance.x && Math.abs(dy) <= tolerance.y;

    if (!nearThePoint) {
      const flat = Math.abs(dy) <= tolerance.y;
      const upright = Math.abs(dx) <= tolerance.x;

      /*
       * BOTH AXES CAN QUALIFY at a diagonal exactly 45 degrees from `from`.
       * The NEARER axis wins, which is what the student is visibly closer to,
       * and ties go to horizontal because it is the commoner intention in a
       * diagram - a level step rather than a vertical jump.
       */
      if (flat && upright) {
        return Math.abs(dy) <= Math.abs(dx)
          ? { point: { x: point.x, y: from.y }, kind: "horizontal" }
          : { point: { x: from.x, y: point.y }, kind: "vertical" };
      }

      if (flat) {
        return { point: { x: point.x, y: from.y }, kind: "horizontal" };
      }

      if (upright) {
        return { point: { x: from.x, y: point.y }, kind: "vertical" };
      }
    }
  }

  let best = null;

  /*
   * AN ENDPOINT FIRST, because it is an EXACT point in both axes and the most
   * specific thing a student can aim at. A station only fixes the x, so an
   * endpoint wins wherever the two are close.
   */
  elements.forEach((element) => {
    if (excludeId && element.id === excludeId) {
      return;
    }

    pointsOf(element).forEach((candidate) => {
      const dx = Math.abs(candidate.x - point.x);
      const dy = Math.abs(candidate.y - point.y);

      if (dx > tolerance.x || dy > tolerance.y) {
        return;
      }

      const distance = Math.hypot(dx, dy);

      if (!best || distance < best.distance) {
        best = { point: { x: candidate.x, y: candidate.y }, kind: "endpoint", distance };
      }
    });
  });

  if (best) {
    return best;
  }

  /*
   * THEN A STATION, WHICH SETS THE X ONLY. The y stays the cursor's, which is
   * the vertical-alignment behaviour: the point is above the tick, not on it.
   */
  (stations || []).forEach((station) => {
    const stationX = Number(station?.position?.x);

    if (!Number.isFinite(stationX)) {
      return;
    }

    const dx = Math.abs(stationX - point.x);

    if (dx > tolerance.x) {
      return;
    }

    if (!best || dx < best.distance) {
      best = {
        point: { x: stationX, y: point.y },
        kind: "station",
        distance: dx,
      };
    }
  });

  return best;
}

/*
 * The x of a graph point, snapped to a station. Kept as a thin wrapper because
 * the tests and the older call sites use it directly.
 */
function snapXToStations(x, stations, scale, range) {
  const context = {
    scale: scale || makeScale(range || { from: 0, to: 1 }, [], {}),
    stations,
    elements: [],
  };

  const snapped = snapPoint({ x, y: 0 }, context);

  return snapped ? snapped.point.x : x;
}

function elementRowHtml(element, selectedId) {
  const pts = pointsOf(element);

  const label =
    element.kind === "line"
      ? `Line ${numberText(element.start.x)}, ${numberText(element.start.y)} to ${numberText(element.end.x)}, ${numberText(element.end.y)}`
      : element.kind === "curve3"
        ? `Curve ${numberText(element.start.x)} to ${numberText(element.end.x)}`
        : `Curve (${pts.length} points)`;

  const cls =
    element.id === selectedId
      ? "sketch-editor-element sketch-editor-element-selected"
      : "sketch-editor-element";

  return `
      <div class="${cls}" data-sketch-element="${escapeHtml(element.id)}">
        <button type="button" class="sketch-editor-element-label"
            data-sketch-select="${escapeHtml(element.id)}">
            ${escapeHtml(label)}
        </button>

        <button type="button" class="sketch-editor-element-delete"
            data-sketch-delete="${escapeHtml(element.id)}"
            aria-label="Delete element">&times;</button>
      </div>
    `;
}

/*
 * THE EXACT COORDINATES OF A SELECTION.
 *
 * Available once something is selected, and never while drawing. The
 * student draws by clicking; this is how they CHECK what they drew, and
 * how they put it exactly right when the click was a few pixels out.
 */
function detailHtml(element) {
  if (!element) {
    return `
        <div class="sketch-editor-detail">
            Select an element to see its exact coordinates.
        </div>
      `;
  }

  const rows = pointsOf(element)
    .map(
      (point, index) => `
          <label class="sketch-editor-point">
            <span>P${index + 1}</span>
            <input type="number" step="any"
                data-sketch-point="${index}"
                data-sketch-axis="x" value="${numberText(point.x)}"/>
            <input type="number" step="any"
                data-sketch-point="${index}"
                data-sketch-axis="y" value="${numberText(point.y)}"/>
          </label>
        `,
    )
    .join("");

  return `
      <div class="sketch-editor-detail">
        <div class="sketch-editor-detail-title">
          ${escapeHtml(element.kind === "line" ? "Straight Line" : "Curve")}
        </div>
        ${rows}
      </div>
    `;
}

function open(options = {}) {
  close();

  const range = options.range || null;

  /*
   * THE BODY'S ELEMENT STATIONS, read once from the caller's live list.
   * Each carries the world x of an element on the parent body, which is what
   * the graph's ticks mark.
   */
  const stations = Array.isArray(options.stations)
    ? options.stations
    : [];

  /*
   * A COPY of the elements, edited here. The feature is not touched
   * until Apply, so Cancel is genuinely Cancel rather than a request to
   * put everything back afterwards.
   */
  let elements = JSON.parse(
    JSON.stringify(options.elements || []),
  );

  let tool = options.tool || "line";
  let selectedId = null;
  let pending = null;
  let sequence = elements.length;

  const dialog = document.createElement("div");

  dialog.className = "drawing-plot-editor sketch-editor";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute(
    "aria-label",
    options.title || "Sketch Editor",
  );

  dialog.innerHTML = `
      <div class="plot-editor">
        <div class="plot-editor-header">
          <div class="plot-editor-title">
            ${escapeHtml(options.title || "Sketch")}
          </div>

          <button type="button" class="plot-editor-close"
              data-sketch-cancel aria-label="Close the sketch editor">
            &times;
          </button>
        </div>

        <div class="plot-editor-body">
          <!--
            THE GRAPH COMES FIRST, AND ACROSS THE FULL WIDTH.

            A diagram is a SHAPE, and reading a shape is what the graph is
            for - so it takes the whole width of the workspace rather than
            sharing a row with the controls. The tools and the element's
            properties sit BELOW it, where they are reached for only when
            something is being placed or changed.
          -->
          <div class="sketch-editor-graph-area">
            <svg class="sketch-editor-graph" data-sketch-graph
                viewBox="0 0 ${WIDTH} ${HEIGHT}"
                preserveAspectRatio="xMidYMid meet"></svg>
          </div>

          <div class="sketch-editor-lower">
            <div class="plot-editor-left">
              <div class="plot-editor-section">TOOLS</div>

              <div class="sketch-editor-tools" data-sketch-tools>
                ${TOOLS.map(
                  (entry) => `
                    <button type="button"
                        class="sketch-editor-tool"
                        data-sketch-tool="${escapeHtml(entry.id)}">
                        ${escapeHtml(entry.label)}
                    </button>
                  `,
                ).join("")}
              </div>

              <div class="sketch-editor-hint" data-sketch-hint></div>
            </div>

            <div class="plot-editor-right">
              <div class="plot-editor-section">ELEMENTS</div>

              <div class="sketch-editor-list" data-sketch-list></div>

              <div data-sketch-detail></div>
            </div>
          </div>
        </div>

        <div class="plot-editor-actions">
          <button type="button" data-sketch-cancel>Cancel</button>

          <button type="button" class="primary" data-sketch-apply>
            Apply
          </button>
        </div>
      </div>
    `;

  document.body.appendChild(dialog);

  const list = dialog.querySelector("[data-sketch-list]");
  const detail = dialog.querySelector("[data-sketch-detail]");
  const svg = dialog.querySelector("[data-sketch-graph]");
  const tools = dialog.querySelector("[data-sketch-tools]");
  const hint = dialog.querySelector("[data-sketch-hint]");

  function selected() {
    return elements.find((entry) => entry.id === selectedId) || null;
  }

  /*
   * ========================================================
   * THE AXIS REACHES THE GEOMETRY, AND HOLDS STILL DURING A GESTURE
   * ========================================================
   *
   * TWO REQUIREMENTS PULL IN OPPOSITE DIRECTIONS, and both are right:
   *
   *   the axis must REACH the drawn geometry, so a diagram is never clipped
   *   and the extent is never stale after a feature is added, moved or deleted;
   *
   *   and it must NOT chase the cursor, or a drag would rescale the graph on
   *   every pointermove and the point being dragged would run away from the
   *   mouse - the defect this editor was fixed for.
   *
   * SO IT IS RECOMPUTED AT THE END OF EVERY GESTURE AND NEVER DURING ONE. A
   * stroke being drawn, a point being dragged and an element being moved all
   * hold the scale they started with; the moment the gesture finishes - the
   * commit, the release, the delete - `refreshScale` rebuilds it from the
   * geometry as it now is. The graph therefore always fits what is drawn, and
   * never moves while the student is drawing it.
   *
   * `drawGraph` is handed the scale rather than deriving one, so there is no
   * second place that could choose a different extent.
   */
  let scale = makeScale(range, elements, { yRange: options.yRange });

  /* Rebuild the extent from the geometry as it stands now. */
  function refreshScale() {
    scale = makeScale(range, elements, { yRange: options.yRange });
  }

  /*
   * WHAT THE HINT SAYS WHILE A STROKE IS OPEN.
   *
   * A LINE needs one more point; a CURVE needs enough to reach three. It names
   * the NEXT ACT, not the state, so the student is never left working out what
   * to do next from a count.
   */
  function pendingMessage() {
    if (pending.kind === "curve3") {
      const remaining = 3 - pending.points.length;

      if (remaining >= 2) {
        return "Click the bend point";
      }

      return "Click the end point";
    }

    return "Click the end point";
  }

  function redraw() {
    drawGraph(svg, elements, range, {
      scale,
      selectedId,
      pending,

      /*
       * WHERE THE CURSOR IS SNAPPED, so the mark is drawn on the point the
       * placement will actually use - the same point the drag is working from,
       * not a second opinion about it.
       */
      activeSnap,

      /*
       * THE BODY'S STATIONS, for the ticks. Passed through unchanged from the
       * caller's live reference list, so the ticks are the body's own element
       * locations rather than anything the sketch maintains.
       */
      stations,
    });

    list.innerHTML = elements.length
      ? elements
          .map((element) => elementRowHtml(element, selectedId))
          .join("")
      : `<div class="sketch-editor-empty">Nothing drawn yet</div>`;

    detail.innerHTML = detailHtml(selected());

    tools
      .querySelectorAll("[data-sketch-tool]")
      .forEach((button) => {
        button.classList.toggle(
          "sketch-editor-tool-active",
          button.dataset.sketchTool === tool,
        );
      });

    const def = TOOLS.find((entry) => entry.id === tool);

    let message = def?.hint || "";

    if (pending?.points.length) {
      message = pendingMessage();
    }

    /*
     * AND WHAT IT IS SNAPPED TO, when it is. Said in words as well as drawn, so
     * the student can tell that the magnet has caught the ENDPOINT of another
     * element rather than the station under it - two different placements that
     * look similar on a dense graph.
     */
    if (activeSnap) {
      message = `${message} - ${activeSnap.kind}`;
    }

    hint.textContent = message;

    options.onPreview?.(elements);
  }

  tools.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sketch-tool]");

    if (!button) {
      return;
    }

    tool = button.dataset.sketchTool;

    /*
     * Switching tool abandons a half-drawn stroke. Leaving the points
     * in place would mean they silently survive as an element the
     * student never finished, which is not a state they asked for.
     */
    pending = null;

    redraw();
  });

  /*
   * ========================================================
   * DRAWING IS PRESS, HOLD, DRAG, RELEASE
   * ========================================================
   *
   * A sketch element is a start and an end, so it is drawn in ONE gesture: the
   * press is the start, the drag follows the cursor, and the release fixes the
   * end. The preview redraws on every move, so the shape is visible while it
   * is being made, and the horizontal position snaps to a body-element tick
   * whenever the cursor is near one.
   *
   * The three-point Curve is the same gesture THREE times - Start, then Bend,
   * then End - each ending in a release, which is what lets the middle point be
   * placed deliberately rather than guessed at the end.
   *
   * ON RELEASE THE Y IS ASKED FOR. The cursor decided WHERE the point is; the
   * popup decides the exact ORDINATE, so a peak is entered as 250 kN rather
   * than aimed at.
   */
  let gesture = null;
  let justFinished = false;

  /*
   * THE POINT THE CURSOR IS CURRENTLY SNAPPED TO, and what it snapped to.
   *
   * This is the DAETUM snap INDICATION for the sketch: without it a student
   * cannot tell a snapped placement from a free one, and the whole point of
   * the magnet is that they can rely on it. It is cleared as soon as the
   * cursor leaves the snap, so it can never linger over a point that is no
   * longer being offered.
   */
  let activeSnap = null;

  /*
   * The graph point under the pointer, SNAPPED, with what it snapped to - so
   * the caller can place from it AND show the indication.
   *
   * THE INDICATION IS RECORDED HERE, once, rather than at each call site: four
   * gestures place points and every one of them should light the same mark, so
   * the record belongs with the question.
   */
  const snapAt = (event, excludeId) => {
    const raw = pointFromEvent(event, svg, scale);

    const snapped = snapPoint(raw, {
      scale,
      stations,
      elements,
      excludeId,

      /*
       * THE POINT THE STROKE IS WORKING FROM, so horizontal and vertical
       * inference has something to align TO. While a stroke is open that is the
       * last point already placed - the start of a line, or the Start and Bend
       * of a curve as they are committed. Outside a stroke there is nothing to
       * align to and the axes are free.
       */
      from: strokeAnchor(),
    });

    activeSnap = snapped
      ? { point: snapped.point, kind: snapped.kind }
      : null;

    return {
      point: snapped ? snapped.point : raw,
      kind: snapped ? snapped.kind : null,
    };
  };

  /*
   * The point the open stroke aligns to, or null when nothing is being drawn.
   */
  const strokeAnchor = () => {
    if (!pending?.points?.length) {
      return null;
    }

    return pending.points[pending.points.length - 1];
  };

  const screenFromEvent = (event) => {
    const rect = svg.getBoundingClientRect
      ? svg.getBoundingClientRect()
      : { left: 0, top: 0 };

    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  /* Which handle of the selected element is under this screen point, if any. */
  const handleAt = (screen) => {
    const element = selected();

    if (!element) {
      return null;
    }

    let best = null;
    let bestDistance = Infinity;

    selectedElementPoints(element).forEach((entry) => {
      const at = scale.toScreen(entry.point);
      const distance = Math.hypot(screen.x - at.x, screen.y - at.y);

      if (distance <= 9 && distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    });

    return best;
  };

  /*
   * A HANDLE WINS THE PRESS; then an ELEMENT IS MOVED; then EMPTY SPACE DRAWS.
   *
   * Deciding at the press is what makes the states predictable - a student
   * cannot start drawing through a feature they meant to grab, and a press on
   * empty space can never move something that is not there.
   */
  svg.addEventListener("pointerdown", (event) => {
    if (tool === "erase" || tool === "select") {
      return;
    }

    event.preventDefault();

    const screen = screenFromEvent(event);

    const handle = handleAt(screen);

    if (handle) {
      const element = selected();

      gesture = {
        type: "point",
        pointerId: event.pointerId,
        elementId: element.id,
        handle,
        original: JSON.parse(JSON.stringify(element)),
        moved: false,
      };

      svg.setPointerCapture?.(event.pointerId);
      return;
    }

    const hit = elementAt(screen, elements, scale);

    if (hit) {
      selectedId = hit.id;

      gesture = {
        type: "move",
        pointerId: event.pointerId,
        elementId: hit.id,
        origin: JSON.parse(JSON.stringify(hit)),
        from: scale.fromScreen(screen),
        moved: false,
      };

      redraw();
      svg.setPointerCapture?.(event.pointerId);
      return;
    }

    /*
     * EMPTY SPACE: DRAW. Whether the RELEASE finishes the stroke (a drag) or
     * leaves it waiting for a second click is decided by how far the pointer
     * travels - see `pointerup`.
     */
    const snapped = snapAt(event);

    if (tool === "curve") {
      if (!pending || pending.kind !== "curve3") {
        pending = { kind: "curve3", points: [snapped.point] };
      } else {
        pending.points = [...pending.points, snapped.point];
      }

      if (pending.points.length >= 3) {
        commitCurve();

        gesture = null;
        redraw();
        return;
      }
    } else {
      pending = { kind: "line", points: [snapped.point] };
    }

    gesture = {
      type: "draw",
      pointerId: event.pointerId,
      startScreen: screen,
      moved: false,
    };

    redraw();
    svg.setPointerCapture?.(event.pointerId);
  });

  svg.addEventListener("pointermove", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    const screen = screenFromEvent(event);

    if (gesture.type === "point") {
      const snapped = snapAt(event, gesture.elementId);

      applyPointMove(gesture, snapped.point);

      gesture.moved = true;

      redraw();
      return;
    }

    if (gesture.type === "move") {
      const now = scale.fromScreen(screen);

      applyWholeMove(gesture, {
        x: now.x - gesture.from.x,
        y: now.y - gesture.from.y,
      });

      gesture.moved = true;

      redraw();
      return;
    }

    /*
     * DRAWING. The newest point follows the cursor, snapped.
     *
     * THE ARRAY GROWS ONCE, THEN THE LIVE END IS REPLACED. A stroke is armed
     * with its FIRST point; the first move APPENDS the point under the cursor,
     * and each later move replaces that one. A stroke that has only its anchor
     * therefore gains an end on the first move - which is what a drag needs -
     * and a stroke that already has one keeps following the cursor.
     *
     * A CURVE works the same way: its already-committed points stand and only
     * the newest follows the cursor.
     */
    const moved = snapAt(event).point;

    if (Math.hypot(
      screen.x - gesture.startScreen.x,
      screen.y - gesture.startScreen.y,
    ) >= 4) {
      gesture.moved = true;
    }

    /*
     * THE LIVE END IS REPLACED ONLY IF ONE IS ALREADY THERE. A stroke armed
     * with its anchor alone - which is every press - GAINS an end here; a
     * stroke that already has one has it moved. Testing the count rather than
     * `gesture.moved` is what makes the first move append even though the same
     * event is the one that decides the gesture was a drag.
     */
    const hasLiveEnd = gesture.liveEnd === true;

    const committed = hasLiveEnd
      ? pending.points.slice(0, pending.points.length - 1)
      : pending.points;

    pending.points = [...committed, moved];

    gesture.liveEnd = true;

    redraw();
  });

  svg.addEventListener("pointerup", (event) => {
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    const finished = gesture;

    gesture = null;

    /*
     * A POINT OR A WHOLE ELEMENT that moved is one finished edit; one that did
     * not stays a plain selection, so a click on a feature selects it rather
     * than nudging it.
     */
    if (finished.type === "point" || finished.type === "move") {
      if (!finished.moved) {
        restoreOriginal(finished);
      }

      /*
       * THE GESTURE IS OVER, SO THE AXIS MAY NOW REACH THE GEOMETRY. It held
       * its extent for the whole drag; this is where it is allowed to grow to
       * fit the shape that drag produced.
       */
      refreshScale();

      redraw();
      return;
    }

    if (!pending || !pending.points.length) {
      return;
    }

    /*
     * A DRAG COMPLETES THE STROKE ON RELEASE. A press that never travelled is
     * a CLICK, and the stroke is left open for the next click - so the student
     * gets whichever idiom they used without saying which they meant.
     */
    if (finished.moved) {
      if (tool === "curve") {
        if (pending.points.length >= 3) {
          commitCurve();
        }
      } else {
        commitLine();
      }

      redraw();
    }
  });

  svg.addEventListener("pointercancel", () => {
    gesture = null;
    activeSnap = null;
  });

  /*
   * THE SNAP IS SHOWN WHILE HOVERING, TOO, not only while dragging.
   *
   * A student choosing where to click hovers before they commit, and the
   * indication is exactly what tells them the click will land on the endpoint
   * they are aiming at. Without this the mark appeared only mid-gesture, which
   * is the moment it is least needed.
   *
   * It runs only when no gesture is in flight - the gesture's own move handler
   * has already recorded the snap it is working from, and re-asking here would
   * be a second opinion about the same point.
   */
  svg.addEventListener("pointermove", (event) => {
    if (gesture) {
      return;
    }

    if (tool !== "line" && tool !== "curve") {
      return;
    }

    const before = activeSnap;

    snapAt(event);

    /*
     * REDRAW ONLY WHEN THE INDICATION CHANGED. A pointer move fires tens of
     * times a second and most of them are not on a snap at all, so repainting
     * the whole graph for every one would make the cursor feel heavy for no
     * visible difference.
     */
    const changed =
      Boolean(before) !== Boolean(activeSnap) ||
      (before &&
        activeSnap &&
        (before.kind !== activeSnap.kind ||
          before.point.x !== activeSnap.point.x ||
          before.point.y !== activeSnap.point.y));

    if (changed) {
      redraw();
    }
  });

  /*
   * THE SECOND CLICK OF A CLICK-MOVE-CLICK STROKE.
   *
   * A press arms the first point; a press-and-release that did NOT travel
   * leaves the stroke open, and the browser's own `click` for it is the first
   * point's click. A SECOND click anywhere on the graph then supplies the next
   * point - which is the end of a line, or the curve's Bend and then its End.
   *
   * A CLICK THAT BELONGED TO A GESTURE IS NOT A SECOND CLICK: a drag has
   * already committed its stroke, and a press on a handle or an element was an
   * edit. `justFinished` is what tells that trailing click apart, so a drag
   * cannot also be read as the start of a new stroke.
   */
  svg.addEventListener("click", (event) => {
    if (tool !== "line" && tool !== "curve") {
      return;
    }

    if (justFinished) {
      justFinished = false;
      return;
    }

    if (!pending || !pending.points.length) {
      return;
    }

    const snapped = snapAt(event);

    pending.points = [...pending.points, snapped.point];

    if (tool === "line" && pending.points.length >= 2) {
      commitLine();
    } else if (tool === "curve" && pending.points.length >= 3) {
      commitCurve();
    }

    redraw();
  });

  /*
   * COMMIT A LINE. Both points came from the cursor, so there is no dialog to
   * answer and nothing to ask for.
   */
  function commitLine() {
    const [start, end] = pending.points;

    if (!start || !end) {
      pending = null;
      return;
    }

    elements.push({
      id: newId(++sequence),
      kind: "line",
      start: { x: start.x, y: start.y },
      end: { x: end.x, y: end.y },
    });

    selectedId = elements[elements.length - 1].id;
    pending = null;
    justFinished = true;

    /* The stroke is committed, so the axis may reach it now. */
    refreshScale();
  }

  /* COMMIT A THREE-POINT CURVE. Start, Bend and End, all from the cursor. */
  function commitCurve() {
    const [start, bend, end] = pending.points;

    elements.push(
      buildThreePointCurve(newId(++sequence), start, bend, end),
    );

    selectedId = elements[elements.length - 1].id;
    pending = null;

    /* The curve is committed, so the axis may reach its bow now. */
    refreshScale();
    justFinished = true;
  }

  /*
   * MOVE ONE DEFINING POINT, from the ORIGINAL element rather than the live
   * one - so a long drag cannot accumulate rounding, and the point lands
   * exactly where the cursor is rather than a little off it.
   */
  function applyPointMove(active, point) {
    const element = elements.find((entry) => entry.id === active.elementId);

    if (!element) {
      return;
    }

    const handle = active.handle;

    /*
     * A LINE'S MIDDLE HANDLE BENDS IT INTO A CURVE.
     *
     * The two ENDS are kept exactly as they are and the element's KIND changes
     * to `curve3`, whose Bend is wherever the student dragged. That is the
     * whole point of the middle handle: a student who has placed the two ends
     * of a moment diagram should not have to delete the line and redraw it as
     * a curve to bow its middle.
     *
     * The bend is taken from the ORIGINAL line's ends, not the live element's,
     * for the same reason every other drag is: a long drag rebuilt from its own
     * previous frame accumulates error.
     */
    if (element.kind === "line" && handle.kind === "bend") {
      const original = active.original;

      delete element.start;
      delete element.end;

      element.kind = "curve3";
      element.start = { x: original.start.x, y: original.start.y };
      element.bend = { x: point.x, y: point.y };
      element.end = { x: original.end.x, y: original.end.y };

      /*
       * THE HANDLE NOW BELONGS TO A CURVE, so the drag carries on against the
       * bend of the element it has become. Without this the next frame would
       * look for a line handle on a curve and leave the bend stuck where it
       * was first set - the curve would jump once and then stop following.
       */
      active.handle = { kind: "bend", index: 1, point: element.bend };

      return;
    }

    if (element.kind === "line") {
      element[handle.kind === "start" ? "start" : "end"] = {
        x: point.x,
        y: point.y,
      };

      return;
    }

    if (element.kind === "curve3") {
      const key =
        handle.kind === "bend"
          ? "bend"
          : handle.kind === "end"
            ? "end"
            : "start";

      element[key] = { x: point.x, y: point.y };

      return;
    }

    /*
     * A LEGACY MANY-POINT CURVE: the dragged point is put back where it was
     * and set anew, so the rest of the curve is untouched.
     */
    const points = (active.original.points || []).map((entry) => ({
      ...entry,
    }));

    points[handle.index] = { x: point.x, y: point.y };

    element.points = points;
  }

  /*
   * MOVE THE WHOLE ELEMENT by a graph-space delta, from the ORIGINAL - so the
   * shape and length are preserved exactly and the feature translates rather
   * than being rebuilt from where the cursor happens to be.
   */
  function applyWholeMove(active, delta) {
    const element = elements.find((entry) => entry.id === active.elementId);

    if (!element) {
      return;
    }

    const original = active.original;

    const shifted = (point) =>
      point ? { x: point.x + delta.x, y: point.y + delta.y } : point;

    if (element.kind === "line") {
      element.start = shifted(original.start);
      element.end = shifted(original.end);
      return;
    }

    if (element.kind === "curve3") {
      element.start = shifted(original.start);
      element.bend = shifted(original.bend);
      element.end = shifted(original.end);
      return;
    }

    element.points = (original.points || []).map(shifted);
  }

  /* Put an element back as it was, for a press that turned out to be a click. */
  function restoreOriginal(active) {
    const index = elements.findIndex((entry) => entry.id === active.elementId);

    if (index >= 0) {
      elements[index] = active.original;
    }
  }

  /*
   * DRAWING ON THE GRAPH: SELECT AND ERASE.
   *
   * Creation is NOT handled here. A Line and a Curve are drawn by the
   * press/drag/release and the second click above, so the browser's `click`
   * that follows a gesture is already accounted for. Select and Erase still act
   * on a click, because they are a single act on an existing element rather
   * than a gesture.
   */
  svg.addEventListener("click", (event) => {
    if (tool === "select") {
      const hit = elementAt(
        pointFromEvent(event, svg, {
          fromScreen: (screen) => screen,
        }),
        elements,
        scale,
      );

      selectedId = hit ? hit.id : null;

      redraw();

      return;
    }

    if (tool === "erase") {
      const hit = elementAt(
        pointFromEvent(event, svg, {
          fromScreen: (screen) => screen,
        }),
        elements,
        scale,
      );

      if (hit) {
        elements = elements.filter((entry) => entry.id !== hit.id);

        if (selectedId === hit.id) {
          selectedId = null;
        }

        /* The tallest thing may just have been erased. */
        refreshScale();
      }

      redraw();

      return;
    }

    /*
     * CREATION IS NOT HANDLED ON `click` ANY MORE.
     *
     * A Line and a Curve are drawn by PRESS, DRAG, RELEASE (see the
     * `pointerdown`/`pointermove`/`pointerup` listeners), so the `click` that
     * the browser fires afterwards is a leftover of that gesture and must not
     * build a second element. Select and Erase still act on a click, because
     * they are not gestures - they are a single act on an existing element.
     */
  });

  /*
   * DOUBLE-CLICK FINISHES A LEGACY MULTI-POINT STROKE.
   *
   * The three-point Curve completes itself on its third release, so this only
   * serves a legacy `curve` element - one drawn by clicking point after point.
   * It is kept so an existing sketch still opens and can be extended the way
   * it was made.
   */
  svg.addEventListener("dblclick", (event) => {
    event.preventDefault();

    if (
      pending &&
      pending.kind === "curve" &&
      pending.points.length >= 2
    ) {
      elements.push({
        id: newId(++sequence),
        kind: "curve",
        points: pending.points.slice(),
      });
    }

    pending = null;

    redraw();
  });

  /*
   * ENTER FINISHES A LEGACY MULTI-POINT STROKE; ESCAPE ABANDONS ONE.
   *
   * The Line and the three-point Curve complete on release, so Enter has
   * nothing to finish for them. It is kept for a legacy `curve`, whose points
   * are placed one click at a time.
   */
  dialog.addEventListener("keydown", (event) => {
    if (
      event.key === "Enter" &&
      pending &&
      pending.kind === "curve"
    ) {
      event.preventDefault();

      if (pending.points.length >= 2) {
        elements.push({
          id: newId(++sequence),
          kind: "curve",
          points: pending.points.slice(),
        });
      }

      pending = null;

      redraw();

      return;
    }

    if (event.key === "Escape") {
      /*
       * Escape FIRST abandons the stroke in progress, and only closes
       * the editor if there was nothing in progress. Otherwise every
       * mistyped Escape would throw away the whole dialog rather than
       * the one unfinished line.
       */
      if (pending) {
        pending = null;

        redraw();

        return;
      }

      event.preventDefault();

      cancel();
    }
  });

  list.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-sketch-delete]");

    if (remove) {
      const id = remove.dataset.sketchDelete;

      elements = elements.filter((entry) => entry.id !== id);

      if (selectedId === id) {
        selectedId = null;
      }

      /* The extent comes from what is LEFT, not from what was removed. */
      refreshScale();

      redraw();

      return;
    }

    const pick = event.target.closest("[data-sketch-select]");

    if (pick) {
      selectedId = pick.dataset.sketchSelect;

      redraw();
    }
  });

  detail.addEventListener("input", (event) => {
    const input = event.target.closest("[data-sketch-point]");

    if (!input) {
      return;
    }

    const element = selected();

    if (!element) {
      return;
    }

    const index = Number(input.dataset.sketchPoint);
    const value = Number(input.value);

    if (!Number.isFinite(value)) {
      return;
    }

    const point =
      element.kind === "line"
        ? [element.start, element.end][index]
        : element.points?.[index];

    if (!point) {
      return;
    }

    if (input.dataset.sketchAxis === "x") {
      point.x = value;
    } else {
      point.y = value;
    }

    redraw();
  });

  const cancel = () => {
    close();

    options.onCancel?.();
  };

  dialog
    .querySelector("[data-sketch-apply]")
    .addEventListener("click", () => {
      const committed = JSON.parse(JSON.stringify(elements));

      close();

      options.onApply?.(committed);
    });

  dialog
    .querySelectorAll("[data-sketch-cancel]")
    .forEach((button) => button.addEventListener("click", cancel));

  openDialog = dialog;
  closeCurrent = cancel;

  redraw();

  dialog.querySelector(".plot-editor-close")?.focus();

  return dialog;
}

function close() {
  if (openDialog) {
    openDialog.remove();
    openDialog = null;
  }

  closeCurrent = null;
}

function isOpen() {
  return openDialog !== null;
}

function handleEscape() {
  if (!openDialog) {
    return false;
  }

  closeCurrent?.();

  return true;
}

const enggSketchEditor = {
  TOOLS,
  SNAP_TOLERANCE_PX,
  buildThreePointCurve,
  close,
  distanceToElement,
  handleEscape,
  isOpen,
  makeScale,
  chooseUnitHeight,
  open,
  pointsOf,
  selectedElementPoints,
  snapPoint,
  snapXToStations,
  snapLabel,
};

export default enggSketchEditor;
