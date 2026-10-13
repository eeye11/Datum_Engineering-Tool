/*
 * ============================================================
 * THE DAETUM MARK - AN OPEN TARGETING RETICLE
 * ============================================================
 *
 * The product's symbol is a targeting mark built from instrumentation:
 *
 *       |        a LONG VERTICAL AXIS running the figure's full height,
 *       |)       well past the arc at both ends
 *     ──·──      a solid CENTRAL DOT at the origin, with an ASYMMETRIC
 *      (___)      HORIZONTAL AXIS reaching further left than right
 *                 and a large OPEN ARC sweeping the top, right and bottom
 *
 * The mark is NOT a conventional capital D. Its D-like quality is a by-product
 * of the open arc, not its purpose: the figure is a target surrounded by an open
 * orbit, and the vertical axis is a RULE THROUGH that orbit rather than the
 * closed left edge of a letter.
 *
 * ============================================================
 * THE ARC IS A FULL CIRCLE ABOUT THE ORIGIN - NOT A BOWL ON THE SPINE
 * ============================================================
 *
 * A ring with a dot in it is an orbit, a target, a compass rose - anything but a
 * letter. What makes this mark read as a D at all is a single geometric fact:
 *
 *     THE ARC IS A CIRCLE WHOSE CENTRE IS THE CENTRAL DOT ITSELF.
 *
 * The dot is the centre of the circle, not a point on its circumference. So the
 * arc wraps AROUND the dot - top, right and bottom - and the vertical axis, which
 * also passes through the dot, is NOT the closed edge of the arc but a rule that
 * crosses it. The opening on the left is the MISSING ARC between the two ends,
 * not a space the spine occupies.
 *
 * ============================================================
 * THE OPENING IS A WIDE GAP, WIDER THAN A SEMICIRCLE'S WORTH
 * ============================================================
 *
 * The arc spans 236 degrees, leaving a 124-degree opening on the left flank. A
 * semicircle would leave the arc looking like a bowl hung on the spine; an
 * almost-closed circle would read as an orbit. 236 degrees sits between the two:
 * an open, deliberate gap that leaves the two ends standing free in the upper-left
 * and lower-left, clear of the vertical axis.
 *
 * ============================================================
 * THE ARC IS LARGER THAN THE OLDER READING, ON PURPOSE
 * ============================================================
 *
 * An earlier drawing centred the bowl to the RIGHT of the spine, so the letter
 * was as tall as it was wide and the arc read as a modest bulge. Making the
 * arc's centre the dot itself - radius 9.4 against a half-height of 12.2 - gives
 * the generous open orbit the design calls for while the vertical axis reaches
 * well beyond it at both ends.
 *
 * ============================================================
 * ONE SOURCE OF TRUTH, TWO RENDERINGS
 * ============================================================
 *
 * The mark appears in the application header AND as the browser tab icon, and
 * the two must never become different drawings of one brand. So the geometry is
 * stated ONCE, here, and both callers use it:
 *
 *   markPaths()        the shapes, as SVG element strings, coloured by
 *                      `currentColor` so the HEADER follows the theme
 *   faviconSource(c)   a standalone SVG document in ONE FIXED COLOUR, because
 *                      the tab icon is a separate document outside the page
 *
 * THE TWO HAVE DIFFERENT COLOUR BEHAVIOUR ON PURPOSE. The header mark is
 * theme-aware - dark ink on the light interface, ice-white on the dark one. The
 * favicon is a CONSTANT BRAND COLOUR under every theme, so the tab looks the
 * same however the application is set. That is why `faviconSource` takes a
 * colour argument rather than reading a token, and why nothing recolours the
 * favicon when the theme changes.
 */

/*
 * The viewBox the mark is drawn in.
 *
 * THE COMPOSITION IS BUILT ON A 24-UNIT GRID AND CENTRED ON `CENTRE_X` /
 * `CENTRE_Y`. That point is the origin of the whole figure: the dot, the crossing
 * of the two axes, AND the centre of the arc's circle. All four elements share it,
 * so there is no offset to compensate for and the mark is already centred in the
 * viewBox - the vertical rule and the arc each overshoot it by a balanced amount.
 */
const VIEW_BOX = 24;

/*
 * The origin: the dot, the axes' crossing, and the arc's own centre.
 *
 * X IS 11.2, NOT 12. The figure is NOT symmetric about the vertical - the
 * horizontal bar reaches further left than right - so its optical centre sits
 * LEFT of the geometric one. Placing the origin a little left of 12 keeps the
 * whole mark visually centred in the viewBox instead of sitting right-heavy.
 */
const CENTRE_X = 11.2;
const CENTRE_Y = 12;

/* The origin's y under the older name, kept for the many callers using it. */
const LETTER_MID_Y = CENTRE_Y;

/*
 * THE ONE STROKE WEIGHT, shared by the spine, the bowl and both axes, so the
 * line work has a single weight and the mark looks engineered rather than
 * assembled from parts.
 *
 * 1.7 is heavy enough to survive a 16 px favicon - where the whole symbol is
 * about sixteen pixels across - without making the mark look like a glyph, and it
 * gives the arc, the two axes and the crosshair the same visual weight so the
 * figure reads as one instrument rather than a heavy circle with thin spokes.
 */
const STROKE_WIDTH = 1.7;

/*
 * THE VERTICAL AXIS - A LONG RULE THROUGH THE ORIGIN.
 *
 * It runs straight through the dot and reaches WELL PAST the arc at both ends,
 * which is what gives the mark its instrument character: the circle is something
 * the rule passes through, not something the rule closes. Its centre IS the
 * origin, so the two ends are equal and the figure is symmetric about the
 * horizontal.
 *
 * IT IS THE LONGEST ELEMENT, AND IT STANDS CLEARLY PROUD OF THE ARC. At a
 * half-length of 12.2 against an arc of radius 9.4 it runs 2.8 units past the arc
 * at each end - enough that the stem reads unmistakably as a rule PASSING THROUGH
 * the circle, its tips floating free above and below the bowl. The reference draws
 * the overshoot generously; a shorter one starts to read as a closed letter D.
 */
const SPINE_X = CENTRE_X;
const SPINE_HALF_HEIGHT = 12.2;

const SPINE_TOP_Y = CENTRE_Y - SPINE_HALF_HEIGHT;
const SPINE_BOTTOM_Y = CENTRE_Y + SPINE_HALF_HEIGHT;

/*
 * DEGREES TO RADIANS, stated before the geometry that needs it.
 */
const toRadians = (degrees) => (degrees * Math.PI) / 180;

/*
 * THE ARC'S OPENING, AND THE SWEEP THAT FOLLOWS FROM IT.
 *
 * The opening is centred on DUE-WEST (180 degrees) - the left flank - so the two
 * ends sit symmetrically in the upper-left and lower-left. A 124-degree opening
 * leaves a 236-degree sweep: comfortably past a semicircle without closing up.
 *
 * WHERE THE ENDS LAND. At a 124-degree opening on a radius of 9.4 the ends sit at
 * about (6.9, 4.4) and (6.9, 19.6) - high and low on the left, roughly ten and
 * eight o'clock. That is far enough out that they stand clear of BOTH the vertical
 * rule and the horizontal bar, so the mouth reads as a deliberate gap; a narrower
 * opening swings them round toward nine o'clock, where they crowd the rule and the
 * mark starts to look like a dollar sign.
 *
 * THE SWEEP FOLLOWS FROM THE OPENING: 360 - 124 = 236 degrees. Both are the same
 * decision seen from either end, so only one is stated.
 */
const ARC_GAP_DEGREES = 124;

/*
 * ============================================================
 * THE ARC - AN OPEN ORBIT CENTRED ON THE ORIGIN
 * ============================================================
 *
 * THE ARC'S CENTRE IS THE ORIGIN - the same point as the dot and the crossing of
 * the two axes. Nothing is offset. The arc is therefore a circle ABOUT the target
 * rather than a bowl hung on one side of it, which is what the reference draws.
 *
 * ITS TWO ENDS DO NOT TOUCH ANYTHING. They stand in the upper-left and lower-left,
 * clear of the vertical rule and clear of the horizontal bar, with the 124-degree
 * opening between them. An earlier draft pulled the ends onto the vertical line to
 * close a letterform; the reference leaves them hanging in the open, and that gap
 * is the mark's most recognisable feature.
 *
 * THE RADIUS IS 9.4 - LARGE, so the circle's diameter (18.8) is close to the
 * vertical rule's whole span (24.4). The circle is therefore nearly as big as the
 * figure, which is what the reference draws: a wide open orbit with a modest cross
 * inside it. This is the property to check first if the mark ever looks wrong - a
 * circle that is small against the rule reads as a ring on a spike, not an orbit.
 *
 * The arc is MASSIVELY larger than the dot - radius 9.4 against 2.9 - which is
 * what gives the orbit its presence without swallowing the point of aim.
 */
const ARC_RADIUS = 9.4;
const BOWL_CX = CENTRE_X;
const BOWL_CY = CENTRE_Y;

/*
 * THE CENTRAL POINT - THE TARGETING DOT.
 *
 * It sits at the ORIGIN, which is also the arc's centre and the crossing of the
 * two axes, so all four elements share one point.
 *
 * RADIUS 2.9 against a stroke of 1.7 is a diameter of 5.8, which is 3.4 times the
 * stroke - just inside the design's 3.5 to 4 times band, and heavy enough to read
 * as a solid point rather than as a bead on two crossing lines.
 */
const DOT_RADIUS = 2.9;
const DOT_X = CENTRE_X;
const DOT_Y = CENTRE_Y;

/*
 * THE HORIZONTAL BAR: an ASYMMETRIC cross through the dot.
 *
 * IT REACHES FURTHER LEFT THAN RIGHT. The left arm is roughly twice the right
 * arm's length, and the crossing sits left of the viewBox's centre to keep the
 * figure optically centred. The reference draws this imbalance deliberately, so
 * it is reproduced rather than tidied into a symmetric cross.
 *
 * BOTH ARMS STOP WELL INSIDE THE ARC - 8.2 left and 4.1 right against a radius
 * of 9.4 - so the bar never touches the circle and the orbit stays the outermost
 * edge of the mark.
 */
const HORIZONTAL_LEFT = 8.2;
const HORIZONTAL_RIGHT = 4.1;

/*
 * THE VERTICAL AXIS IS THE SPINE - the stem and the axis are one line, so there
 * is no separate vertical element to draw. This constant is kept as the exported
 * name for callers that describe the axis, and it equals the spine's half-height.
 */
const VERTICAL_ARM = SPINE_HALF_HEIGHT;

/*
 * THE FIGURE'S HORIZONTAL MIDDLE, for a caller that needs to centre the mark.
 *
 * The visual extremes are the horizontal bar's long LEFT tip and the bowl's
 * right edge. Because the bar reaches further left than right, the visual centre
 * is the midpoint of those two, NOT `CENTRE_X` - and it is exported so the header
 * and the favicon can align to one number rather than each approximating it.
 */
const VISUAL_MID_X = (SPINE_X - HORIZONTAL_LEFT + SPINE_X + ARC_RADIUS) / 2;

/*
 * THE VERTICAL RULE'S OWN ENDPOINTS.
 *
 * It spans the figure's full height and OVERSHOOTS the arc's ends at both ends
 * of the stem - the rule's tips float free of the bowl rather than stopping at
 * it. The overshoot is symmetric about the origin so the stem stays balanced.
 */
const SPINE_TOP = SPINE_TOP_Y;
const SPINE_BOTTOM = SPINE_BOTTOM_Y;
/*
 * ============================================================
 * THE FAVICON COLOUR - ONE CONSTANT, NOT A THEME VARIABLE
 * ============================================================
 *
 * The tab icon is a separate document: it cannot read the page's CSS variables,
 * and it must not change when the theme does. It therefore carries ONE literal
 * colour under every theme - light, dark and every palette.
 *
 * THE VALUE IS DAETUM'S OWN BRAND TEAL (`--datum-green` in the light theme,
 * #087E83). It is chosen rather than inherited because a fixed-colour favicon
 * cannot guarantee the same contrast on every browser's tab strip: the priority
 * is a distinctive, consistent mark, not a contrast guarantee that no fixed
 * colour can make. Against a light tab strip and a dark one alike, a mid-teal
 * mark stays legible, which is the compromise a stable identity requires.
 */
const FAVICON_COLOUR = "#087E83";

/*
 * A point on the bowl's circle.
 *
 * Angles run 0 degrees EAST and increase CLOCKWISE in screen coordinates, which
 * is the convention an SVG arc sweep already uses - so "clockwise from the
 * upper-left" maps onto these numbers with no sign juggling.
 */
const arcPoint = (degrees) => ({
    x: BOWL_CX + ARC_RADIUS * Math.cos(toRadians(degrees)),
    y: BOWL_CY + ARC_RADIUS * Math.sin(toRadians(degrees)),
});

/*
 * The OPENING is symmetric about DUE-WEST (180 degrees) - the left flank.
 *
 * The arc therefore starts at `180 + GAP/2` and ends at `180 - GAP/2`. With a
 * 124-degree opening those are 242 and 118 degrees: the first is in the UPPER-LEFT
 * and the second in the LOWER-LEFT, and both stand clear of the vertical rule.
 *
 * GETTING THIS WRONG IS WHAT BROKE THE MARK BEFORE. An earlier draft centred the
 * opening on DUE-NORTH instead of due-west, which placed the arc's two ends on top
 * of one another - a zero-length chord - and the renderer drew a full circle with
 * no opening at all. The opening's axis has to be the LEFT one.
 */
const ARC_UPPER_END_DEGREES = 180 + ARC_GAP_DEGREES / 2;
const ARC_LOWER_END_DEGREES = 180 - ARC_GAP_DEGREES / 2;

/*
 * THE ENDS ARE TAKEN STRAIGHT FROM THE CIRCLE - NOT SNAPPED TO ANYTHING.
 *
 * This is what keeps the opening open. The two points are where the circle meets
 * those two angles, so they land wherever the geometry puts them: left of the
 * vertical rule, clear of it, and clear of the horizontal bar. Snapping their x to
 * the rule - which an earlier draft did - drags them onto the axis and closes the
 * arc into a ring.
 */
const ARC_UPPER_END = arcPoint(ARC_UPPER_END_DEGREES);
const ARC_LOWER_END = arcPoint(ARC_LOWER_END_DEGREES);

/*
 * The path is drawn UPPER END -> LOWER END with `large-arc=1 sweep=1`, which is
 * the clockwise route over the top, down the right and round the bottom. The
 * opposite flags are just as valid SVG and draw the arc round the LEFT instead,
 * leaving the mouth on the right - a mirrored mark. See `markPaths` below.
 */
const ARC_START = ARC_UPPER_END;
const ARC_END = ARC_LOWER_END;

const round = (value) => Number(value.toFixed(3));

/*
 * ============================================================
 * THE SHAPES, IN PAINTING ORDER
 * ============================================================
 *
 *     vertical axis -> horizontal axis -> bowl -> dot
 *
 * THE TWO AXES ARE FIRST, so they sit BENEATH the bowl where the figure's
 * left flank crosses them: the stem passes UNDER the arc's upper and lower ends
 * rather than over them. THE DOT IS LAST, so it sits ON TOP of both axes -
 * otherwise a line would run visibly through the filled centre and the dot would
 * read as a crossing rather than as a point.
 *
 * Every element takes its colour from `currentColor`, so the caller decides the
 * colour by setting `color`. Nothing here is hardcoded to black or to a literal
 * hex, which is what lets ONE drawing serve light mode, dark mode and every
 * palette.
 *
 * THE BOWL IS STRUCK AS A PATH, not as a `<circle>` with a dash: a dash pattern
 * would put the opening wherever the dashes happened to begin, which is fragile
 * and not reproducible. An explicit arc between two stated angles is exact.
 */
function markPaths() {
    return `
        <path
            d="M${SPINE_X} ${round(SPINE_TOP)}V${round(SPINE_BOTTOM)}"
            fill="none"
            stroke="currentColor"
            stroke-width="${STROKE_WIDTH}"
            stroke-linecap="round"
        />
        <path
            d="M${round(DOT_X - HORIZONTAL_LEFT)} ${DOT_Y}H${round(DOT_X + HORIZONTAL_RIGHT)}"
            fill="none"
            stroke="currentColor"
            stroke-width="${STROKE_WIDTH}"
            stroke-linecap="round"
        />
        <path
            d="M${round(ARC_START.x)} ${round(ARC_START.y)}A${round(ARC_RADIUS)} ${round(ARC_RADIUS)} 0 1 1 ${round(ARC_END.x)} ${round(ARC_END.y)}"
            fill="none"
            stroke="currentColor"
            stroke-width="${STROKE_WIDTH}"
            stroke-linecap="round"
        />
        <circle
            cx="${DOT_X}"
            cy="${DOT_Y}"
            r="${DOT_RADIUS}"
            fill="currentColor"
        />
    `.trim();
}

/*
 * ============================================================
 * THE FAVICON, AS A STANDALONE DOCUMENT
 * ============================================================
 *
 * A browser tab is a SEPARATE DOCUMENT, not part of the page, so it cannot
 * inherit `currentColor` and cannot read the theme's CSS variables. It therefore
 * carries the one fixed brand colour above.
 *
 * `transparent` is the ground: no background, border or shadow, so the tab shows
 * the symbol on whatever surface the browser draws rather than on a coloured
 * tile. The previous icon was a green rounded square with a yellow triangle - a
 * tile with a background, which this design rules out.
 *
 * The geometry is the SAME coordinates the header uses, so the tab icon and the
 * header mark are literally one drawing rather than two that were adjusted to
 * match.
 */
function faviconSource(colour = FAVICON_COLOUR) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_BOX} ${VIEW_BOX}" role="img" aria-label="DAETUM">
${markPaths().replace(/currentColor/g, colour)}
</svg>`;
}

const enggDaetumMark = {
    VIEW_BOX,
    LETTER_MID_Y,
    STROKE_WIDTH,
    SPINE_X,
    SPINE_HALF_HEIGHT,
    BOWL_CX,
    ARC_RADIUS,
    ARC_GAP_DEGREES,
    DOT_RADIUS,
    DOT_X,
    DOT_Y,
    HORIZONTAL_LEFT,
    HORIZONTAL_RIGHT,
    VERTICAL_ARM,
    VISUAL_MID_X,
    FAVICON_COLOUR,
    markPaths,
    faviconSource,
};

export default enggDaetumMark;

export {
    VIEW_BOX,
    LETTER_MID_Y,
    STROKE_WIDTH,
    SPINE_X,
    SPINE_HALF_HEIGHT,
    BOWL_CX,
    ARC_RADIUS,
    ARC_GAP_DEGREES,
    DOT_RADIUS,
    DOT_X,
    DOT_Y,
    HORIZONTAL_LEFT,
    HORIZONTAL_RIGHT,
    VERTICAL_ARM,
    VISUAL_MID_X,
    FAVICON_COLOUR,
    markPaths,
    faviconSource,
};
