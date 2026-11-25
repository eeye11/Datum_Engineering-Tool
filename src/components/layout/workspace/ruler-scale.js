/*
 * ============================================================
 * THE RULERS' SCALE: WHAT A TICK IS WORTH, AND WHERE IT GOES
 * ============================================================
 *
 * The arithmetic of the measurement rulers, kept entirely separate from the
 * DOM. Everything here is a pure function of numbers, so the rules that decide
 * how far apart ticks sit, which interval is labelled and where a label lands
 * can be checked without a browser - and the drawing code only has to turn the
 * answers into lines and text.
 *
 * WHAT THE NUMBERS MEAN.
 *
 * The rulers read the DRAWING's own internal coordinates - the same numbers the
 * grid snaps to, the Features panel shows and a point's geometry stores. The
 * canvas shows those coordinates through the camera:
 *
 *     screen.x = width / 2 + (x - panX) * k
 *     screen.y = height / 2 - (y - panY) * k
 *     k = BASE_PIXELS_PER_UNIT * zoom
 *
 * so one drawing unit is `k` screen pixels, and the visible world rectangle
 * follows from the canvas size, the zoom and the pan. `visibleRange` below is
 * that rectangle exactly - it is not re-derived from a second camera model, so
 * the rulers cannot drift from the drawing they measure.
 *
 * THE UNIT IS THE MILLIMETRE, NOT A PIXEL.
 *
 * DAETUM's coordinates ARE millimetres: the saved source states `[x=1mm,
 * y=1mm]` and its header says "on paper one unit is 1 mm", and the status bar
 * prints `mm` beside the pointer. See `drawing-units.js`, which is the one
 * place that fact is written down. So this module measures in mm and says so;
 * it never presents a screen pixel as a length.
 *
 * At 100% zoom one millimetre is `BASE_PIXELS_PER_UNIT` (3.6) screen pixels, so
 * a 900px canvas spans 250 mm. That is the sheet's real width - the large
 * numbers were a TRUE statement printed too densely, not a wrong unit - and the
 * fix is the adaptive interval below, which labels every 50 mm at that zoom
 * rather than every 5.
 *
 * WHY THE SUBDIVISION IS CHOSEN THE WAY IT IS.
 *
 * A fixed interval (a tick every 5 units, say) is legible at one zoom and
 * useless at every other: at 400% the ticks are 48px apart with nothing
 * between them, and at 25% they are 3px apart and merge into a solid band.
 * So the interval is chosen against the available room - a major interval that
 * lands close to a comfortable on-screen gap - and subdivided by a number a
 * draughtsman actually reads: halves, fifths or tenths, never a value that
 * needs counting to five between two labels.
 */

/* On-screen room a major interval should aim for. */
export const DEFAULT_MAJOR_GAP_PX = 88;

/*
 * Every other label is shown when the major ticks are this close together.
 *
 * Measured for the SMALLEST label the ruler has room for. A four-figure
 * number at 9px type is about 24px wide, and two labels need their width plus
 * a readable gap - so below this many pixels between majors the ruler labels
 * every second one instead of squeezing a number between two of them.
 */
export const LABEL_EVERY_OTHER_BELOW_PX = 48;

/*
 * The subdivisions a major interval may be cut into, with the smallest one
 * still allowed to be this many pixels wide.
 *
 * FIFTHS ARE THE FIRST CHOICE, because a scale of halves and fifths is how a
 * drafting ruler is printed: 25 is read straight off the tick between 0 and
 * 50. Tenths are the next step up when the interval is large, and an interval
 * only too small for either - under about 40px between majors - is left whole
 * and labelled sparsely. `1` is the last entry so there is always a rule, and
 * its zero floor makes it the one that can never be refused.
 */
const SUBDIVISIONS = [
    { count: 10, minPx: 7 },
    { count: 5, minPx: 9 },
    { count: 2, minPx: 9 },
    { count: 1, minPx: 0 }
];

/*
 * THE FLOOR UNDER THE AVERAGE GAP.
 *
 * The step is the nearest nice number to the target, so the realised gap can
 * come in a little under it - the nearest of 1, 2 and 5 is never more than
 * about 1.4x below the target. This is the smallest average major gap a ruler
 * accepts for a given target; below it the next decade's step is used. Sixty
 * pixels is enough for a four-figure label and the tick beside it.
 */
export const MIN_MAJOR_GAP_PX = 60;

/*
 * THE COARSEST INTERVAL AN AUTOMATIC SCALE WILL CHOOSE, in millimetres.
 *
 * Without a ceiling, zooming far out takes the ruler through 200, 500, 1000...
 * and the labels become long numbers that say very little about the sheet. A
 * hundred millimetres is a hand's width of the drawing and is as coarse as a
 * useful reading gets; beyond it the subdivisions carry the detail and the
 * 100 mm marks are the reference, which is what the ".5" labels below make
 * unnecessary - at that scale the ruler labels every major.
 *
 * It is a CEILING, not a fixed choice: at 100% the ruler picks 50 mm, and only
 * zooms under about 35% reach 100 mm.
 */
export const MAX_AUTO_MAJOR_MM = 100;

const NEVER_BELOW_VALUE = 0.08;

/*
 * A major interval close to a power of ten times 1, 2 or 5 - the numbers a
 * scale is printed in. The fit is measured in log space, so "2" is as close to
 * 2.4 as "5" is to 6, and neither is favoured.
 */
const PREFERRED_MANTISSAS = [1, 2, 5];

/*
 * WHAT A LABEL HAS ROOM FOR, in characters. A label is written as an integer
 * when it is one and to at most two decimals when it is not, so this is only
 * used to keep the label's box inside the ruler at an edge.
 */
export function formatRulerLabel(value) {
    const rounded = Math.abs(value) < 1e-9 ? 0 : value;

    if (Number.isInteger(rounded)) {
        return String(rounded);
    }

    return String(Number(rounded.toFixed(2)));
}

export function preferredMantissa(value) {
    const magnitude = Math.abs(value);

    if (!Number.isFinite(magnitude) || magnitude <= 0) {
        return 1;
    }

    const exponent = Math.floor(Math.log10(magnitude));

    return Number((magnitude / (10 ** exponent)).toPrecision(3));
}

/*
 * THE NICEST STEP AROUND `value`, NOT THE NEXT ONE ABOVE IT.
 *
 * The interval is chosen from 1, 2 and 5 times a power of ten, and the
 * nearest of those to the room available is used. Rounding UP would be the
 * obvious rule and is the wrong one: at a 40px gap it would take the step
 * from 10 to 20 and throw away half the labels the ruler had room for.
 *
 * THE DISTANCE IS MEASURED IN LOG SPACE, because 2 is as far from 2.4 as 5 is
 * from 6 - a scale reads the same at a 2.4x step either way, so neither
 * mantissa is favoured.
 */
export function snapToNiceStep(value) {
    const exponent = Math.floor(Math.log10(value));

    let best = null;
    let bestDistance = Infinity;

    for (const decade of [exponent - 1, exponent, exponent + 1]) {
        for (const mantissa of PREFERRED_MANTISSAS) {
            const candidate = mantissa * (10 ** decade);

            const distance = Math.abs(
                Math.log(candidate) - Math.log(value)
            );

            if (distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
            }
        }
    }

    return best;
}

/*
 * The scale of the ruler on an axis.
 *
 * `pixelsPerUnit` is the camera's (BASE_PIXELS_PER_UNIT x zoom); the interval
 * is the major step chosen for the room the ruler has. `subdivisions` is how
 * many parts a major interval is cut into, `minorStep` the world distance
 * between two of them, and `labelEvery` how many majors pass between labels -
 * two when the labels would otherwise touch.
 */
export function rulerScale({
    pixelsPerUnit,
    targetGapPx = DEFAULT_MAJOR_GAP_PX,
    maxMajorMm = MAX_AUTO_MAJOR_MM
}) {
    if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) {
        return null;
    }

    const gap = Number.isFinite(targetGapPx) && targetGapPx > 0
        ? targetGapPx
        : DEFAULT_MAJOR_GAP_PX;

    const raw = gap / pixelsPerUnit;

    let majorStep = snapToNiceStep(raw);
    let majorPx = majorStep * pixelsPerUnit;

    /*
     * A step that landed too close to its neighbour is lifted one rung. The
     * check is on the REALISED gap - `majorStep` is in world units, so it has
     * to be measured back in pixels at this camera's scale.
     */
    if (majorPx < Math.min(MIN_MAJOR_GAP_PX, gap * 0.9)) {
        majorStep = snapToNiceStep(majorStep * 1.0000001);
        majorPx = majorStep * pixelsPerUnit;
    }

    /*
     * AND THE CEILING. Zooming far out asks for an interval wider than the
     * ruler will print; the largest automatic interval that fits is then
     * used, and the subdivisions carry the detail from there.
     */
    const ceiling = Number.isFinite(maxMajorMm) && maxMajorMm > 0
        ? maxMajorMm
        : Infinity;

    if (majorStep > ceiling) {
        majorStep = snapToNiceStep(ceiling);
        majorPx = majorStep * pixelsPerUnit;
    }

    const subdivision = SUBDIVISIONS.find(
        (option) => majorPx / option.count >= option.minPx
    ) || SUBDIVISIONS[SUBDIVISIONS.length - 1];

    return {
        pixelsPerUnit,
        majorStep,
        minorStep: majorStep / subdivision.count,
        subdivisions: subdivision.count,
        majorPx,
        minorPx: majorPx / subdivision.count,
        /*
         * EVERY MAJOR IS LABELLED when it has room. Two labels touch below
         * about 48px, and that only happens at high zoom where the interval
         * is 1-5 mm - so a coarse interval (10 mm and up) is always labelled,
         * which is what keeps a "25" tick from existing unlabelled beside
         * "0" and "50".
         */
        labelEvery:
            majorPx < LABEL_EVERY_OTHER_BELOW_PX && majorStep < 10 ? 2 : 1
    };
}

/*
 * The world coordinate at the two edges of the canvas.
 *
 * `edge` semantics are screen edges: `min` is the axis's low screen edge
 * (left, for x; top, for y) and `max` its high one (right, bottom). The screen
 * coordinate grows with world x and AGAINST world y, which is why the two
 * conversions are not the same expression.
 *
 * The first visible value is pulled back to a round multiple of `step`, so a
 * tick sits exactly on a labelled number rather than a fraction beside it.
 */
function edgeWorldValue(axis, edge, size, pixelsPerUnit, pan) {
    const fromCentre = (edge - size / 2) / pixelsPerUnit;

    return axis === "x"
        ? pan + fromCentre
        : pan - fromCentre;
}

/*
 * The ticks and labels to draw for one axis.
 *
 * `size` is the ruler's length in pixels - the canvas's width for the top
 * ruler and its height for the right one - so a label and a tick are placed in
 * exactly the space the ruler occupies. A tick's `position` is in ruler
 * pixels; a label's `value` is the world number it stands for, and the caller
 * writes it in the unit the ruler names.
 *
 * `measured` is false when the tick list had to be produced without a real
 * canvas box (the scale fell back). Such a snapshot is still internally
 * consistent - the ticks are where the numbers say - but the caller should
 * not take it as a statement about the on-screen spacing.
 */
export function rulerTicks({
    axis,
    size,
    pan,
    pixelsPerUnit,
    targetGapPx = DEFAULT_MAJOR_GAP_PX,
    /*
     * The SNAP SPACING, used only as an automatic interval's fallback when the
     * camera's scale is unavailable (an unlaid-out canvas reports no box). The
     * grid's own spacing is the sheet's established coarse unit, so the ruler
     * falls back to it rather than inventing a third one.
     */
    snapSpacing,
    majorStep
}) {
    let scale = rulerScale({ pixelsPerUnit, targetGapPx });

    /*
     * A FALLBACK THAT STILL MEASURES SOMETHING. Without a scale the ticks would
     * have to sit at arbitrary pixels, which is the one thing a ruler must not
     * do; the snapshot reports `scale: null` and the drawing code leaves the
     * axis blank until the canvas has a box to measure.
     */
    if (!scale) {
        const spacing = Number(snapSpacing);

        if (!Number.isFinite(spacing) || spacing <= 0) {
            return {
                scale: null,
                measured: false,
                ticks: [],
                labels: []
            };
        }

        scale = rulerScale({
            pixelsPerUnit: 1,
            targetGapPx: Math.max(snapSpacing, spacing)
        });
    }

    if (!Number.isFinite(size) || size <= 0) {
        return { scale, measured: false, ticks: [], labels: [] };
    }

    const step = Number.isFinite(majorStep) && majorStep > 0
        ? majorStep
        : scale.majorStep;

    /*
     * THE STEP MAY BE THE STUDENT'S. A caller can name the major interval
     * (the ticks then subdivide it exactly as the automatic rule would), and
     * the subdivisions are re-derived for that interval.
     */
    const majorPx = step * scale.pixelsPerUnit;
    const subdivision = SUBDIVISIONS.find(
        (option) => majorPx / option.count >= option.minPx
    ) || SUBDIVISIONS[SUBDIVISIONS.length - 1];

    const minorStep = step / subdivision.count;
    const minorPx = majorPx / subdivision.count;

    /*
     * THE LABEL RULE IS THE SCALE'S, re-derived for the step actually used -
     * the caller may have named their own interval, and the labels must follow
     * that interval rather than the automatic one it replaced.
     */
    const labelEvery =
        majorPx < LABEL_EVERY_OTHER_BELOW_PX && step < 10 ? 2 : 1;

    const lowEdge = edgeWorldValue(axis, 0, size, scale.pixelsPerUnit, pan);
    const highEdge = edgeWorldValue(axis, size, size, scale.pixelsPerUnit, pan);

    const worldMin = Math.min(lowEdge, highEdge);
    const worldMax = Math.max(lowEdge, highEdge);

    /*
     * A RULER THAT CANNOT MEASURE DOES NOT INVENT A MEASUREMENT. A zoom so far
     * out that the smallest subdivision would be under a tenth of a pixel is
     * answered with an empty axis rather than with hundreds of ticks that merge
     * into a line and a scale nobody can read.
     */
    if (!(minorPx >= NEVER_BELOW_VALUE)) {
        return { scale, measured: true, ticks: [], labels: [] };
    }

    const firstTick = Math.ceil(worldMin / minorStep - 1e-9) * minorStep;

    const positionOf = (value) => {
        const fromCentre = (value - pan) * scale.pixelsPerUnit;

        return axis === "x"
            ? size / 2 + fromCentre
            : size / 2 - fromCentre;
    };

    /*
     * A CAP, not a guess. `size`, the scale and the interval already bound the
     * number of ticks to `size / minorPx` - about 1000 at the longest ruler on
     * the widest screen - so this only ever catches a camera whose numbers do
     * not describe the canvas, and stops it filling the page with DOM.
     */
    const LIMIT = 2000;

    /*
     * THE ZERO ALWAYS GETS A TICK AND A LABEL.
     *
     * The origins of these axes are the two numbers a student orients by - the
     * corner of the sheet's coordinate system - and a ruler that skipped 0
     * because its tick fell a thousandth of a unit outside the window would be
     * unreadable exactly where it matters. So 0 joins the list whenever it is
     * within a single major interval of the window, whether the window ends
     * just short of it or begins just past it.
     *
     * The list is keyed by the tick's INDEX, so the zero and the regular ticks
     * that straddle it are one entry rather than two drawn a fraction of a
     * pixel apart.
     */
    const includeZero =
        (worldMin <= 0 && 0 - worldMin <= majorStep) ||
        (worldMin >= 0 && worldMin <= majorStep);

    const values = new Map();
    const addValue = (value) => {
        values.set(Math.round(value / minorStep), value);
    };

    if (includeZero) {
        addValue(0);
    }

    for (
        let index = 0, value = firstTick;
        value <= worldMax + 1e-9 && index < LIMIT;
        index++, value = firstTick + index * minorStep
    ) {
        addValue(value);
    }

    const ticks = [];
    const labels = [];

    for (
        const value of
        [...values.entries()]
            .sort((a, b) => a[0] - b[0])
            .map((entry) => entry[1])
    ) {
        const position = positionOf(value);

        /* The zero test is in units of the step, so rounding cannot lie. */
        const units = Math.round(value / minorStep);
        const isMajor = units % subdivision.count === 0;
        const majorIndex = isMajor ? units / subdivision.count : null;

        ticks.push({
            value: Math.abs(value) < minorStep / 1e6 ? 0 : value,
            position,
            major: isMajor
        });

        if (
            isMajor &&
            majorIndex !== null &&
            majorIndex % labelEvery === 0
        ) {
            labels.push({
                value: Math.abs(value) < minorStep / 1e6 ? 0 : value,
                position
            });
        }
    }

    return {
        scale: {
            ...scale,
            majorStep: step,
            majorPx,
            minorStep,
            subdivisions: subdivision.count,
            minorPx
        },
        measured: true,
        ticks,
        labels
    };
}

/*
 * A LABEL SHORT ENOUGH FOR THE RULER, AND A TICK THAT IS ALWAYS VISIBLE.
 *
 * Text in the ruler is a few pixels wide, and a label naively placed at its
 * tick is half outside the canvas at the very edge. `clampLabelCentre` centres
 * it and pulls it back inside; `clampLabelText` shortens the TEXT before the
 * label itself is clipped, so the number stays whole.
 */
export function clampLabelText(text, maxCharacters) {
    const limit = Math.max(1, Math.floor(Number(maxCharacters) || 1));

    return String(text).length <= limit
        ? String(text)
        : String(text).slice(0, limit);
}

/*
 * Where to clamp a label's centre so the text stays inside the ruler.
 *
 * The text's own half-width is passed in, so a "1250" at the right-hand edge
 * is pushed back by half its width rather than by a guessed amount.
 */
export function clampLabelCentre(position, halfWidth, size) {
    if (!Number.isFinite(position) || !Number.isFinite(size) || size <= 0) {
        return position;
    }

    const half = Math.max(0, Number(halfWidth) || 0);

    if (size <= half * 2) {
        return size / 2;
    }

    return Math.min(
        Math.max(position, half + 1),
        size - half - 1
    );
}
