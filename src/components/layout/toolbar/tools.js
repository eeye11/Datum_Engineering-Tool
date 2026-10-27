import { fluidsToolGroups } from "../../../features/workspace/model/fluids/fluids-tools.js";
import { DYNAMICS_TOOL_GROUPS as dynamicsToolGroups } from "../../../features/workspace/dynamics/dynamics-hierarchy.js";

const drawingIcon = content => `<svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">${content}</svg>`;
const iconStroke = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';


export const toolIcons = {
    "Boundary Stress": drawingIcon(`<rect ${iconStroke} x="5" y="6" width="10" height="9"/><path ${iconStroke} d="M6 5V1m4 4V1m4 4V1M4 8H1m3 4H1m15-4h3m-3 4h3M6 16v3m4-3v3m4-3v3"/>`),
    "Stress Element": drawingIcon(`<path ${iconStroke} d="M10 2l8 8-8 8-8-8z"/>`),
    "Thermodynamic Cycles": drawingIcon(`<path ${iconStroke} d="M16.1 7A6.8 6.8 0 0 0 4.3 5.9L2.5 8M2.5 4v4h4M3.9 13a6.8 6.8 0 0 0 11.8 1.1l1.8-2.1M17.5 16v-4h-4"/>`),
    "Turbine / Compressor": drawingIcon(`<path ${iconStroke} d="M3 3l14 5v4L3 17z"/>`),
    "Nozzle / Diffuser": drawingIcon(`<path ${iconStroke} d="M3 3l14 5M3 17l14-5"/>`),
    "Tank": drawingIcon(`<rect ${iconStroke} x="4" y="2" width="12" height="16" rx="3"/>`),
    "Work": drawingIcon(`<path ${iconStroke} d="M3 10h14m-4-4 4 4-4 4"/>`),
    "Electric Work": drawingIcon(`<path ${iconStroke} d="M3 3h11v4l2 1-4 2 4 2-4 2 2 1v2H3"/>`),
    "Mechanical Work": drawingIcon(`<path ${iconStroke} d="M2 10h11m0-1h2v2h-2zM13 9C12 6 10 2 13 2S16 6 15 9ZM15 11C16 14 18 18 15 18S12 14 13 11Z"/>`),
    "Heat Transfer": drawingIcon(`<path ${iconStroke} d="M3 7h13m-4-4 4 4-4 4M17 14H4m4-4-4 4 4 4"/>`),
    "Heat Entering": drawingIcon('<path d="M3 10h14m-5-5 5 5-5 5" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    "Heat Leaving": drawingIcon('<path d="M3 10h14m-5-5 5 5-5 5" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    "Const Temp/Pressure Lines": '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 17L7 11H12C14 11 16 7 18 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "Process Diagrams": '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3v14h14M6 14C7 8 8 5 10 5S14 11 17 14" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    "Const. Pressure Lines": '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 15L8 10h5l4-7M3 18l5-5h5l4-6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    "Const. Temp Lines": '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    "Process Plot": drawingIcon(`<path ${iconStroke} d="M3 3v14h14M3 3l-2 3m2-3 2 3m12 11-3-2m3 2-3 2"/>`),
    "Saturation Curve": drawingIcon(`<path ${iconStroke} d="M3 3v14h14M6 14C7.2 9.2 7.8 5.5 10 5.5C12.4 5.5 14.4 11.5 17 14"/>`),
	Select: drawingIcon(`<path ${iconStroke} d="M4 3l3 12 3-4 4 4 1-1-4-4 5-1z"/>`),
	"Dynamics Bodies": drawingIcon(`<circle ${iconStroke} cx="7" cy="8" r="2.6"/><path ${iconStroke} d="M3 16c0-2.4 1.8-4 4-4s4 1.6 4 4"/><rect ${iconStroke} x="11.5" y="6" width="5.5" height="5.5"/>`),
	"Dynamics Particle": drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="2"/><path ${iconStroke} d="M10 3v5M10 12v5M3 10h5M12 10h5"/>`),
	"Dynamics Rigid Body": drawingIcon(`<rect ${iconStroke} x="5" y="5" width="10" height="10"/><circle ${iconStroke} cx="10" cy="10" r="2"/>`),
	Trajectory: drawingIcon(`<path ${iconStroke} d="M3 16C6 16 6 6 10 6s4 10 7 10"/><circle fill="currentColor" cx="3" cy="16" r="1.3"/>`),
	Kinematics: drawingIcon(`<path ${iconStroke} d="M4 17L16 4m-4 0h4v4"/><path ${iconStroke} stroke-dasharray="2 2" d="M4 9a8 8 0 0 1 5-5"/>`),
	"Polar Vector": drawingIcon(`<path ${iconStroke} d="M5 15L15 6m-5 0h5v5"/><path ${iconStroke} d="M5 15a10 10 0 0 1 3-6"/>`),
	"Angular Vector": drawingIcon(`<path ${iconStroke} d="M10 10l5-4m-5 4a6 6 0 1 0 5 2.6"/><path ${iconStroke} d="M12 11l3-1 .5 3"/>`),
	Spring: drawingIcon(`<path ${iconStroke} d="M3 10h2l1.5-4 2 8 2-8 2 8 2-8 1.5 4h2"/>`),
	"Mechanical Elements": drawingIcon(`<path ${iconStroke} d="M3 7h3l1.5-3 2 6 2-6 2 6 1.5-3h2"/><path ${iconStroke} d="M3 14h3m8 0h3M7 14h6"/>`),
	"Viscous Damper": drawingIcon(`<path ${iconStroke} d="M3 10h3m8 0h3M6 10h2m2 0h2M8 6v8"/><rect ${iconStroke} x="10" y="6" width="4" height="8"/>`),
	"Spring–Damper Element": drawingIcon(`<path ${iconStroke} d="M3 6h3l1-2 1.5 4L10 4l1.5 4 1 2H17"/><path ${iconStroke} d="M3 15h4M13 15h4"/><path ${iconStroke} d="M7 13h6M10 13v4"/>`),
	Pulley: drawingIcon(`<circle ${iconStroke} cx="10" cy="7" r="3.2"/><path ${iconStroke} d="M6.8 7v2h6.4V7M7 9v6M13 9v6"/><circle fill="currentColor" cx="10" cy="7" r="1"/>`),
	Line: drawingIcon(`<path ${iconStroke} d="M4 16L16 4"/>`),
	Polyline: drawingIcon(`<path ${iconStroke} d="M3 14l4-8 5 5 5-7"/><circle ${iconStroke} cx="3" cy="14" r="1"/><circle ${iconStroke} cx="7" cy="6" r="1"/><circle ${iconStroke} cx="12" cy="11" r="1"/>`),
	Triangle: drawingIcon(`<path ${iconStroke} d="M10 3l7 13H3z"/><circle ${iconStroke} cx="10" cy="3" r="1"/>`),
	Polygon: drawingIcon(`<path ${iconStroke} d="M10 3l6 4v7l-6 3-6-3V7z"/>`),
	"Freeform Polygon": drawingIcon(`<path ${iconStroke} d="M4 6l5-3 7 4-2 8-6 2-4-4z"/><circle ${iconStroke} cx="4" cy="6" r="1"/><circle ${iconStroke} cx="9" cy="3" r="1"/><circle ${iconStroke} cx="16" cy="7" r="1"/><circle ${iconStroke} cx="14" cy="15" r="1"/><circle ${iconStroke} cx="8" cy="17" r="1"/>`),
	Arc: drawingIcon(`<path ${iconStroke} d="M4 14a7 7 0 0 1 10-9"/><path ${iconStroke} d="M13 5h2v2"/>`),
	Circle: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="6"/>`),
	Rectangle: drawingIcon(`<rect ${iconStroke} x="4" y="5" width="12" height="10"/>`),
	"Construction Geometry": drawingIcon(`<path ${iconStroke} stroke-dasharray="2 2" d="M3 15L17 5"/>`),
	"Construction Line": drawingIcon(`<path ${iconStroke} stroke-dasharray="3 2" d="M3 15L17 5"/>`),
	"Centre Line": drawingIcon(`<path ${iconStroke} stroke-dasharray="5 2 1 2" d="M3 15L17 5"/>`),
	Move: drawingIcon(`<path ${iconStroke} d="M10 3v14M3 10h14M10 3l-2 2M10 3l2 2M10 17l-2-2M10 17l2-2M3 10l2-2M3 10l2 2M17 10l-2-2M17 10l-2 2"/>`),
	Rotate: drawingIcon(`<path ${iconStroke} d="M15 7a6 6 0 1 0 1 6"/><path ${iconStroke} d="M15 3v4h-4"/>`),
	Mirror: drawingIcon(`<path ${iconStroke} d="M10 3v14M4 6l4 4-4 4M16 6l-4 4 4 4"/>`),
	Trim: drawingIcon(`<path ${iconStroke} d="M4 5l11 10M15 5L4 15M3 10h6"/>`),
	Extend: drawingIcon(`<path ${iconStroke} d="M4 10h12M12 6l4 4-4 4M4 5v10"/>`),
	Pan: drawingIcon(`<path ${iconStroke} d="M6 10V6a1 1 0 0 1 2 0v3V4a1 1 0 0 1 2 0v5V5a1 1 0 0 1 2 0v4V6a1 1 0 0 1 2 0v6c0 3-2 5-5 5-2 0-3-1-4-3l-1-2a1 1 0 0 1 2-1z"/>`),
	Zoom: drawingIcon(`<circle ${iconStroke} cx="8.5" cy="8.5" r="4.5"/><path ${iconStroke} d="M12 12l4 4M8.5 6v5M6 8.5h5"/>`),

	/*
	 * THE TWO FIT MODES.
	 *
	 * One drawing shape for each, saying what it fits rather than how
	 * it does it: the whole-page icon brackets a wide drawing, the
	 * selected icon brackets one small thing. They are drawn from the
	 * same corner-bracket language so they read as a pair, and they
	 * differ in what is between the brackets - which is exactly the
	 * difference between the two commands.
	 */

	"Fit Whole Page": drawingIcon(`<path ${iconStroke} d="M3 6V3h3M14 3h3v3M17 14v3h-3M6 17H3v-3"/><path ${iconStroke} d="M5 12l3-4 3 3 4-4"/>`),

	"Fit Selected": drawingIcon(`<path ${iconStroke} d="M3 6V3h3M14 3h3v3M17 14v3h-3M6 17H3v-3"/><rect ${iconStroke} x="8" y="9" width="4" height="3"/>`),
	Plant: drawingIcon(`<rect ${iconStroke} x="5" y="6" width="10" height="8"/><path ${iconStroke} d="M2 8h3m10 4h3M2 8l1.5-1.5M2 8l1.5 1.5m14 2L16 8.5m1.5 1.5L16 11.5"/>`),
	/*
	 * DIMENSION is the one dimension tool.
	 *
	 * The retired Smart Dimension and Variable Dimension tools are gone from
	 * the catalogue: a dimension is a single annotation tool whose linear,
	 * aligned, angular, radius, diameter and arc-length types are read from
	 * the geometry the student picks, and whose displayed value is editable
	 * text rather than a second tool.
	 */
	Dimension: drawingIcon(`<path ${iconStroke} d="M4 6v12M16 6v12M4 12h12M4 12l3-2M4 12l3 2M16 12l-3-2M16 12l-3 2"/>`),
	"Annotation": drawingIcon(`<path ${iconStroke} d="M4 5h8M4 9h8M4 13h5"/><path ${iconStroke} d="M12 16l1.5-4L18 7l-4.5 1.5L12 13"/>`),
	"Note / Text": drawingIcon(`<path ${iconStroke} d="M4 4h12v9H9l-4 3v-3H4zM7 7h6M7 10h4"/>`),

	/*
	 * LABEL - a short identifier for a feature or subfeature.
	 *
	 * Drawn as a tag with its own leader tick, because that is what a label
	 * IS: a name hung off a piece of geometry rather than a paragraph of
	 * prose. It is deliberately different from Note / Text, which is drawn
	 * as a text box, so the two read as different tools and different
	 * features.
	 */
	Label: drawingIcon(`<path ${iconStroke} d="M4 6h9l3 4-3 4H4z"/><path ${iconStroke} d="M7 8.5h4M7 11.5h2"/>`),
	Leader: drawingIcon(`<path ${iconStroke} d="M4 15L15 5M12 5h4v4"/><circle ${iconStroke} cx="4" cy="15" r="1"/>`),
	Arrow: drawingIcon(`<path ${iconStroke} d="M4 16L16 4M11 4h5v5"/>`),
	Callout: drawingIcon(`<path ${iconStroke} d="M4 4h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path ${iconStroke} d="M6 7h5M6 10h3"/>`),
	Symbol: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="6"/><path ${iconStroke} d="M7 10h6M10 7v6"/>`),
	Tolerance: drawingIcon(`<rect ${iconStroke} x="3" y="5" width="14" height="10"/><path ${iconStroke} d="M6 8l2 2-2 2M11 8h3M11 12h3"/>`),
	Table: drawingIcon(`<rect ${iconStroke} x="3" y="4" width="14" height="12"/><path ${iconStroke} d="M3 8h14M3 12h14M8 4v12M13 4v12"/>`),
	Reference: drawingIcon(`<path ${iconStroke} d="M4 4h12v12H4zM7 7h6M7 10h6M7 13h3"/>`),
	"Coordinate System": drawingIcon(`<path ${iconStroke} d="M4 16V4M4 16h12M1 7l3-3 3 3M13 13l3 3-3 3"/>`),
	"Reference Point": drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="2"/><path ${iconStroke} d="M10 3v4M10 13v4M3 10h4M13 10h4"/>`),
	"Reference Line": drawingIcon(`<path ${iconStroke} stroke-dasharray="3 2" d="M3 15L17 5"/><circle ${iconStroke} cx="3" cy="15" r="1"/><circle ${iconStroke} cx="17" cy="5" r="1"/>`),

	/*
	 * Reference Arc.
	 *
	 * The Reference Line's icon, with the straight chord replaced by
	 * an arc, and dashed for the same reason it is: the dash is how
	 * the whole reference family is marked as construction rather
	 * than final geometry, so the two read as relatives.
	 */
	"Reference Arc": drawingIcon(`<path ${iconStroke} stroke-dasharray="3 2" d="M3 15A8 8 0 0 1 17 5"/><circle ${iconStroke} cx="3" cy="15" r="1"/><circle ${iconStroke} cx="17" cy="5" r="1"/>`),
	Moment: drawingIcon(`<path ${iconStroke} d="M6 14a6 6 0 1 1 7-9M13 5h3v3M10 10l3-3"/>`),
	Moments: drawingIcon(`<path ${iconStroke} d="M6 14a6 6 0 1 1 7-9M13 5h3v3M10 10l3-3"/>`),
	Support: drawingIcon(`<path ${iconStroke} d="M4 15h12M6 15l4-7 4 7M4 17h12"/>`),
	Supports: drawingIcon(`<path ${iconStroke} d="M4 15h12M6 15l4-7 4 7M4 17h12"/>`),
	Beam: drawingIcon(`<path ${iconStroke} d="M3 7h14v6H3zM6 7v6M14 7v6"/>`),
	Bodies: drawingIcon(`<path ${iconStroke} d="M5 7l5-3 5 3v6l-5 3-5-3zM5 7l5 3 5-3M10 10v6"/>`),
	Connections: drawingIcon(`<path ${iconStroke} d="M3 10h5M12 10h5M8 7h4v6H8z"/>`),
	Load: drawingIcon(`<path ${iconStroke} d="M10 3v11M7 11l3 3 3-3M5 17h10"/>`),
	Loads: drawingIcon(`<path ${iconStroke} d="M10 3v11M7 11l3 3 3-3M5 17h10"/>`),

	/*
	 * Statics feature icons.
	 *
	 * Every real Statics feature owns a distinct symbol here.
	 * These are the single authoritative artworks reused by the
	 * toolbar, the Feature Tree and the Features panel through
	 * featureIcons, so one feature never shows two different
	 * glyphs and no feature falls back to a generic Statics icon.
	 */
	Truss: drawingIcon(`<path ${iconStroke} d="M3 6h14M3 6l14 8M17 6L3 14M3 14h14M8 6v8M12 6v8"/>`),
	Cable: drawingIcon(`<path ${iconStroke} d="M3 5c5 8 9 8 14 0"/><circle ${iconStroke} cx="3" cy="5" r="1.2"/><circle ${iconStroke} cx="17" cy="5" r="1.2"/>`),
	"Point Load": drawingIcon(`<path ${iconStroke} d="M10 15V5"/><path ${iconStroke} d="M10 3l-3 4h6z"/><circle ${iconStroke} cx="10" cy="16.5" r="1.2"/>`),
	"Distributed Load": drawingIcon(`<path ${iconStroke} d="M2 16h16M2 18h16M3 4h14M3 4v10M6.5 4v10M10 4v10M13.5 4v10M17 4v10"/><path ${iconStroke} d="M2 13l1 1 1-1M5.5 13l1 1 1-1M9 13l1 1 1-1M12.5 13l1 1 1-1M16 13l1 1 1-1"/>`),
	"Varying Distributed Load": drawingIcon(`<path ${iconStroke} d="M2 16h16M2 18h16M3 11l7-7h7M3 11v3M6.5 7.5V14M10 4v10M13.5 4v10M17 4v10"/><path ${iconStroke} d="M2 13l1 1 1-1M5.5 13l1 1 1-1M9 13l1 1 1-1M12.5 13l1 1 1-1M16 13l1 1 1-1"/>`),
	"Applied Moment": drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="2"/><path ${iconStroke} d="M10 5.6a4.4 4.4 0 0 1 3.7 2"/><path ${iconStroke} d="M10 14.4a4.4 4.4 0 0 1-3.7-2"/><path ${iconStroke} d="M12.6 5.2l3 1.7-1.7 3"/><path ${iconStroke} d="M7.4 14.8l-3-1.7 1.7-3"/>`),
	"Pin Support": drawingIcon(`<path ${iconStroke} d="M4 14h12M7 14l3-6 3 6"/><path ${iconStroke} d="M4 17h12"/><circle ${iconStroke} cx="10" cy="9" r="1.6"/>`),
	"Roller Support": drawingIcon(`<path ${iconStroke} d="M5 11h10M7 11l3-6 3 6"/><circle ${iconStroke} cx="7" cy="13.5" r="1.5"/><circle ${iconStroke} cx="13" cy="13.5" r="1.5"/><path ${iconStroke} d="M4 17h12"/>`),
	"Fixed Support": drawingIcon(`<path ${iconStroke} d="M6 2v16M6 8h12v4H6M6 3L2 7M6 7l-4 4M6 11l-4 4M6 15l-3 3"/>`),
	"Smooth Support": drawingIcon(`<path ${iconStroke} d="M5 12h10"/><path ${iconStroke} d="M8 12a2 2 0 0 1 4 0"/><path ${iconStroke} d="M4 15h12"/><path ${iconStroke} d="M4 17h12"/>`),
	"Pin Connection": drawingIcon(`<path ${iconStroke} d="M3 10h5M12 10h5"/><circle ${iconStroke} cx="10" cy="10" r="3"/><circle ${iconStroke} cx="10" cy="10" r="1"/>`),
	"Fixed Connection": drawingIcon(`<path ${iconStroke} d="M3 7h3v6H3zM14 7h3v6h-3zM6 8h8v4H6z"/><path ${iconStroke} d="M8 10h4M10 8v4"/>`),
	"Slider Connection": drawingIcon(`<path ${iconStroke} d="M3 8h4M3 12h4M13 10h4"/><path ${iconStroke} d="M8 6h4v8H8z"/><path ${iconStroke} d="M9 3h2M9 17h2"/>`),
	"Free Body Diagram": drawingIcon(`<rect ${iconStroke} x="5" y="5" width="10" height="10"/><path ${iconStroke} d="M10 2v3M10 15v3M2 10h3M15 10h3"/>`),
	Equilibrium: drawingIcon(`<path ${iconStroke} d="M10 4v12M4 8h12M6 8l-2 4h4zM14 8l-2 4h4z"/>`),
	/*
	 * THE ANALYSIS ICONS.
	 *
	 * One family, five members, built from the same parts: a 20x20
	 * viewBox, the shared iconStroke, round caps and joins, no fills,
	 * and a common 10,10 origin. They are meant to be read at about
	 * twenty pixels in a toolbar, so each is built from at most three
	 * strokes and none of them from a chart metaphor.
	 *
	 * What they say, in the student's own language:
	 *
	 *   Force Components  one force, split into two
	 *   Resultant         two forces, combined into one
	 *   SFD               shear, which JUMPS - a stepped profile
	 *   BMD               moment, which CURVES - a smooth bow
	 *   AFD               axial force, in blocks about the axis
	 *
	 * The last three are the ones that had to be told apart, and they
	 * are separated by exactly the property that separates the real
	 * diagrams: SFD is discontinuous, BMD is smooth, AFD is a block
	 * diagram on a member axis. Stepped-versus-curved is the
	 * difference a structural engineer looks for, so it is the
	 * difference drawn here.
	 *
	 * These are ICONS, not example solutions. They show the shape a
	 * diagram takes, never a value, so a student cannot read an
	 * answer off the toolbar.
	 */

	/*
	 * FORCE COMPONENTS: one diagonal force out of a common origin,
	 * with the horizontal and vertical components drawn as the two
	 * legs of the triangle it completes.
	 *
	 * The three vectors meet at ONE corner, and that is the whole
	 * message: a single force F, resolved into Fx along the span and
	 * Fy up the member. The dot marks the shared origin so the three
	 * strokes read as one figure rather than as three arrows that
	 * happen to be nearby.
	 *
	 * The earlier version of this drew the component legs as an
	 * L-shaped path that ran straight through the diagonal, so the
	 * three strokes piled up in the corner and read as a solid
	 * block at toolbar size. Each leg is now its own stroke,
	 * starting where it is meant to start.
	 */
	"Force Components": drawingIcon(`<path ${iconStroke} d="M3 16h13"/><path ${iconStroke} d="M16 16V4"/><path ${iconStroke} d="M3 16 16 4"/><path ${iconStroke} d="M12.5 4H16"/><path ${iconStroke} d="M16 8v4"/><circle ${iconStroke} cx="3" cy="16" r="1.3"/>`),

	/*
	 * RESULTANT: two forces converging on an origin and one long
	 * arrow leaving it. The two input vectors are clearly paired and
	 * the output is clearly singular, which is the whole difference
	 * from Force Components - where the one input is a diagonal and
	 * the two outputs are the legs.
	 */
	"Resultant": drawingIcon(`<path ${iconStroke} d="M10 10L3 4M10 10L3 16"/><path ${iconStroke} d="M10 10h7"/><path ${iconStroke} d="M15 8l3 2-3 2"/><path ${iconStroke} d="M1.5 2.5l3 3M1.5 17.5l3-3"/>`),

	/*
	 * SFD: a stepped shear profile with positive and negative regions
	 * on either side of the zero baseline.
	 */
	"Shear Force (SFD)": drawingIcon(`<path ${iconStroke} d="M2 10h16"/><path ${iconStroke} d="M3 10V4h5v3h4v9h5v-6"/>`),

	/*
	 * BMD: a linear segment followed by a quadratic curve, returning
	 * to the zero baseline.
	 */
	"Bending Moment (BMD)": drawingIcon(`<path ${iconStroke} d="M2 15h16"/><path ${iconStroke} d="M2 15L8 6Q12 0 18 15"/>`),

	/*
	 * AFD: a constant axial-force block above the zero baseline,
	 * with outward arrows indicating tension along the member.
	 */
	"Axial Force (AFD)": drawingIcon(`<path ${iconStroke} d="M2 11h16M4 11V4h12v7M3 16h14M5 14l-2 2 2 2M15 14l2 2-2 2"/>`),
	Particle: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="2"/><path ${iconStroke} d="M10 3v5M10 12v5M3 10h5M12 10h5"/>`),
	"Rigid Body": drawingIcon(`<rect ${iconStroke} x="5" y="5" width="10" height="10"/><circle ${iconStroke} cx="10" cy="10" r="2"/>`),
	Velocity: drawingIcon(`<path ${iconStroke} d="M3 14h12M11 7l5 7-5 1"/>`),
	Acceleration: drawingIcon(`<path ${iconStroke} d="M3 14h12M11 6l5 8-5 2"/><path ${iconStroke} d="M6 8l3-3"/>`),
	Rotation: drawingIcon(`<path ${iconStroke} d="M15 7a6 6 0 1 0 1 6M15 3v4h-4"/>`),
	"Motion Path": drawingIcon(`<path ${iconStroke} d="M3 14c3-8 8 5 14-6"/><circle ${iconStroke} cx="3" cy="14" r="1"/><circle ${iconStroke} cx="17" cy="8" r="1"/>`),
	Pipe: drawingIcon(`<path ${iconStroke} d="M4 5v8a3 3 0 0 0 3 3h9M4 5h4M12 16v-5a2 2 0 0 1 2-2h2"/>`),
	Reservoir: drawingIcon(`<path ${iconStroke} d="M4 6h12v9H4zM4 9h12M7 4v2M13 4v2"/>`),
	Valve: drawingIcon(`<path ${iconStroke} d="M3 6.5l7 3.5-7 3.5zM17 6.5l-7 3.5 7 3.5z"/>`),
	/*
	 * PUMP: a circle with a directional triangle inside it - the triangle's
	 * point says which way the flow is being pushed, which is what tells a pump
	 * apart from the Flow Meter beside it at twenty pixels.
	 */
	Pump: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="6"/><path ${iconStroke} d="M7.8 7.2v5.6l4.4-2.8z"/>`),
	/*
	 * FLOW ARROW: a single directional arrow - a shaft with one head - because
	 * the object is a free arrow, not a mark riding a run.
	 */
	"Flow Arrow": drawingIcon(`<path ${iconStroke} d="M3 10h13m-4-4 4 4-4 4"/>`),
	Pressure: drawingIcon(`<circle ${iconStroke} cx="10" cy="11" r="6"/><path ${iconStroke} d="M10 11l3-3M7 4h6"/>`),

	/*
	 * ========================================================
	 * THE FLUIDS ICONS
	 * ========================================================
	 *
	 * One family, built from the same parts as every other icon: a 20x20
	 * viewBox, the shared iconStroke, round caps and joins, no fills. They are
	 * meant to be read at about twenty pixels in a toolbar.
	 *
	 * The three that already existed - Pipe, Reservoir, Valve and Pump - are
	 * REUSED rather than redrawn, and the two new labels that name a variant of
	 * one of them (Pipe / Duct, Reservoir / Tank) reuse that same artwork, so a
	 * Pipe and a Pipe / Duct are not two different glyphs for one idea.
	 */

	/*
	 * PIPE / DUCT. The existing Pipe, with the two parallel walls of a duct
	 * closed off at each end - a run of pipe seen along its length.
	 */
	"Pipe / Duct": drawingIcon(`<path ${iconStroke} d="M3 7h14M3 13h14M3 7v6M17 7v6M7 7v6M13 7v6"/>`),

	/*
	 * FLOW PATHS. The GROUP heading's icon: a run of pipe turning one corner,
	 * drawn as the same double wall as its children so the closed group reads as
	 * "the parts of a run". The elbow in the middle is what distinguishes it from
	 * the Pipe / Duct entry beneath it.
	 */
	"Flow Paths": drawingIcon(`<path ${iconStroke} d="M3 6h9a2 2 0 0 1 2 2v8M3 12h7a2 2 0 0 0 2-2V6M3 6v6M14 11v5"/>`),

	/*
	 * FLOW INDICATORS. The GROUP heading's icon: a run with the direction arrow
	 * drawn on it - how the flow is SHOWN, which is exactly what the group holds.
	 */
	"Flow Indicators": drawingIcon(`<path ${iconStroke} d="M3 6h14M3 14h14M6 10h8M11 7l3 3-3 3"/>`),

	/*
	 * ELBOW. TWO PARALLEL CURVED LINES forming a rounded 90 degree bend, with the
	 * two open ends visible - the fitting as it is drawn on the sheet, rather
	 * than a single centreline with corner ticks.
	 */
	Elbow: drawingIcon(
		`<path ${iconStroke} d="M3 4v5.5a7.5 7.5 0 0 0 7.5 7.5H16M6.5 4v4.5a4 4 0 0 0 4 4H16"/>`
	),

	/*
	 * JUNCTION. Three runs meeting: one in from the left, one out to the right,
	 * and one down, with the tee at the middle.
	 */
	Junction: drawingIcon(`<path ${iconStroke} d="M3 8h14M10 8v8"/><circle ${iconStroke} cx="10" cy="8" r="1.4"/>`),

	/*
	 * REDUCER / EXPANDER. Two pairs of parallel lines tapering between widths -
	 * the fitting as it is drawn in a run, rather than a shape in empty space.
	 */
	"Reducer / Expander": drawingIcon(`<path ${iconStroke} d="M3 6h4l6 4-6 4H3M10 10h7M3 6v2M3 14v-2M10 4v2M10 14v-2"/>`),

	/*
	 * RESERVOIR / TANK. A simple open-top vessel: two walls and a floor, with no
	 * lid and no fluid inside - the OBJECT, not a symbol for fluid.
	 */
	"Reservoir / Tank": drawingIcon(`<path ${iconStroke} d="M4 4v12h12V4"/>`),

	/*
	 * FLOW METER. A circular gauge with a pointer - deliberately a DIAL rather
	 * than a pipe with a box on it, so it is never confused with the Pump.
	 */
	"Flow Meter": drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="6"/><path ${iconStroke} d="M10 10l3.4-3.4"/><circle fill="currentColor" cx="10" cy="10" r="1"/>`),

	/*
	 * FLUID LEVEL. A horizontal fluid-level line with a gentle wave - the surface
	 * in a vessel, not a dimension and not a dashed rule.
	 */
	"Fluid Level": drawingIcon(`<path ${iconStroke} d="M3 11c2-1.6 3.4 1.6 5.4 0s3.4 1.6 5.4 0 2.4.9 3.2.4M5 6.5v-2M15 6.5v-2M5 6.5h10"/>`),

	/*
	 * PRESSURE TAP. A tap into a run: the pipe wall, and the stem that reads the
	 * pressure at that point.
	 */
	"Pressure Tap": drawingIcon(`<path ${iconStroke} d="M3 13h14M10 13V7"/><circle ${iconStroke} cx="10" cy="5.5" r="1.6"/>`),

	/*
	 * FLOW INDICATORS & ANNOTATIONS. The group's own heading artwork: the run
	 * with its direction arrow, now also carrying a level line - how the flow is
	 * SHOWN, which is everything the group holds.
	 */
	"Flow Indicators & Annotations": drawingIcon(`<path ${iconStroke} d="M3 6h14M3 14h14M6 10h8M11 7l3 3-3 3"/>`),

	/*
	 * PIPE DIAMETER. A bore measured across: the pipe's two walls with the
	 * dimension between them.
	 */
	"Pipe Diameter": drawingIcon(`<path ${iconStroke} d="M5 4v12M15 4v12M5 10h10M5 10l2-2M5 10l2 2M15 10l-2-2M15 10l-2 2"/>`),

	/*
	 * SECTION PLANE. A section line with clear viewing-direction arrows: the
	 * trace, and the two arrows that say which way the section looks.
	 */
	"Section Plane": drawingIcon(`<path ${iconStroke} d="M9 3v14" stroke-dasharray="2.6 1.8"/><path ${iconStroke} d="M9 6h7m-3-2.6 3 2.6-3 2.6M9 16h7m-3-2.6 3 2.6-3 2.6"/>`),

	/*
	 * FLOW DIRECTION DIAGRAM. A route with directional arrows along it - the
	 * annotated run, which is what the diagram is - and NOT a bare arrow, so it
	 * is told apart from the Flow Arrow.
	 */
	"Flow Direction Diagram": drawingIcon(`<path ${iconStroke} d="M3 15h6l4-5h4"/><path ${iconStroke} d="M10.5 15h3m-1.6-1.6 1.6 1.6-1.6 1.6M13.5 10h3m-1.6-1.6 1.6 1.6-1.6 1.6"/>`),

	/*
	 * PRESSURE PROFILE. Axes with a connected plotted line - a graph of the
	 * student's own numbers, not a pipe with a curve beneath it.
	 */
	"Pressure Profile": drawingIcon(`<path ${iconStroke} d="M4 3v13h13"/><path ${iconStroke} d="M6 13.5 9 10.5l2.5 2 4.5-6"/><circle fill="currentColor" cx="6" cy="13.5" r="1"/><circle fill="currentColor" cx="9" cy="10.5" r="1"/><circle fill="currentColor" cx="11.5" cy="12.5" r="1"/><circle fill="currentColor" cx="16" cy="6.5" r="1"/>`),

	/*
	 * FLOW PROFILE. Axes with a stepped flow curve - a second profile graph, told
	 * apart from the Pressure Profile by its BARS UNDER THE LINE (a flow at a
	 * station) rather than by a different frame.
	 */
	"Flow Profile": drawingIcon(`<path ${iconStroke} d="M4 3v13h13"/><path ${iconStroke} d="M6 13V9.5h3V7h3V11h3"/><path ${iconStroke} d="M6 15.5v-1M9 15.5v-1M12 15.5v-1M15 15.5v-1"/>`),

	/*
	 * FLUID PROPERTY LABEL. A written note about a fluid: the note's corner and
	 * ruled lines, in the same language as the Annotate Note icon.
	 */
	"Fluid Property Label": drawingIcon(`<path ${iconStroke} d="M4 4h12v12H4zM7 8h6M7 11h6M7 14h3"/>`),

	/*
	 * FLOW RATE LABEL. A rate written against a run: the flow arrow with a
	 * value box hung from it.
	 */
	"Flow Rate Label": drawingIcon(`<path ${iconStroke} d="M3 8h9M10 5l3 3-3 3M6 12h9v4H6z"/>`),

	/*
	 * ELEVATION MARKER. A level marked on a drawing: the datum line with its
	 * leader and the level's own arrow, which is how an elevation is written.
	 */
	"Elevation Marker": drawingIcon(`<path ${iconStroke} d="M3 15h14M6 15L14 5M14 5l-3 1M14 5l1 3"/>`),

	/*
	 * THE ROUTE FEATURE ICONS.
	 *
	 * A route is drawn as a bent single line, and its two parts are the straight
	 * run and the corner - so the three icons are the whole route, one straight
	 * piece of it, and the corner itself. They read as one family because they
	 * are: the same line, at three scales of the same idea.
	 */
	"Pipe Route": drawingIcon(`<path ${iconStroke} d="M3 16h6l4-5h4M3 16h3M16 11h-2"/><circle ${iconStroke} cx="9" cy="16" r="1"/><circle ${iconStroke} cx="13" cy="11" r="1"/>`),
	"Pipe Segment": drawingIcon(`<path ${iconStroke} d="M3 10h14M3 10h3M14 10h3"/><circle ${iconStroke} cx="3" cy="10" r="1"/><circle ${iconStroke} cx="17" cy="10" r="1"/>`),
	"Control Volume": drawingIcon(`<rect ${iconStroke} x="4" y="5" width="12" height="10" stroke-dasharray="2 2"/><path ${iconStroke} d="M2 10h2M16 10h2"/>`),
	"Piston Cylinder": drawingIcon(`<path ${iconStroke} d="M4 4v13h12V4M4 10h12M4 12h12M10 10V3"/>`),
	"Piston Cylinder With Stoppers": drawingIcon(`<path ${iconStroke} d="M4 4v13h12V4M4 11h12M4 13h12M10 11V3"/><path ${iconStroke} d="M4 6h3v2H4M16 6h-3v2h3"/>`),
	"State Point": drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="2"/><path ${iconStroke} d="M10 3v5M10 12v5M3 10h5M12 10h5"/>`),
	"Process Path": drawingIcon(`<path ${iconStroke} d="M3 14c3-7 5 4 8-2s4-3 6-6"/><path ${iconStroke} d="M14 6h3v3"/>`),
	Wall: drawingIcon(`<path ${iconStroke} d="M6 3v14M10 3v14M14 3v14M3 5h14M3 10h14M3 15h14"/>`),
	Layer: drawingIcon(`<path ${iconStroke} d="M4 6h12M4 10h12M4 14h12"/>`),
	"Heat Flux": drawingIcon(`<path ${iconStroke} d="M4 10h12M12 6l4 4-4 4M7 6l-3 4 3 4"/>`),
	Temperature: drawingIcon(`<path ${iconStroke} d="M8 5a2 2 0 0 1 4 0v6a4 4 0 1 1-4 0zM10 4v8"/>`),
	Convection: drawingIcon(`<path ${iconStroke} d="M4 6c2-2 3 2 5 0s3 2 5 0 2 1 2 1M4 11c2-2 3 2 5 0s3 2 5 0 2 1 2 1"/>`),
	Radiation: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="3"/><path ${iconStroke} d="M10 3v2M10 15v2M3 10h2M15 10h2M5 5l1 1M14 14l1 1M15 5l-1 1M6 14l-1 1"/>`),
	Shaft: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="5"/><path ${iconStroke} d="M3 10h14M10 3v14"/>`),
	Stress: drawingIcon(`<path ${iconStroke} d="M4 15h12M4 15l3-8 3 5 3-7 3 10"/>`),
	Strain: drawingIcon(`<path ${iconStroke} d="M5 4v12M15 4v12M5 7h10M5 13h10"/>`),
	"Boundary Condition": drawingIcon(`<path ${iconStroke} d="M4 4v12M4 16h12M7 13l-3 3 3 1M13 13l3 3-3 1"/>`),
	Part: drawingIcon(`<path ${iconStroke} d="M5 7l5-3 5 3v6l-5 3-5-3zM5 7l5 3 5-3M10 10v6"/>`),
	Hole: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="6"/><circle ${iconStroke} cx="10" cy="10" r="2"/>`),
	Gear: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="3"/><path ${iconStroke} d="M10 3v3M10 14v3M3 10h3M14 10h3M5 5l2 2M13 13l2 2M15 5l-2 2M7 13l-2 2"/>`),
	Fastener: drawingIcon(`<path ${iconStroke} d="M6 4h8M6 7h8M8 7v9M12 7v9M5 16h10"/>`),
	"Section View": drawingIcon(`<path ${iconStroke} d="M4 4h12v12H4zM4 8h12M8 4v12"/>`),
	Block: drawingIcon(`<rect ${iconStroke} x="5" y="5" width="10" height="10"/><path ${iconStroke} d="M2 10h3M15 10h3"/>`),
	Gain: drawingIcon(`<path ${iconStroke} d="M4 3v14l12-7z"/><path ${iconStroke} d="M8 10h4"/>`),
	Sum: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="7"/><path ${iconStroke} d="M8 7h4M10 5v4M8 13h4"/>`),
	Sensor: drawingIcon(`<path ${iconStroke} d="M6 14a6 6 0 0 1 0-8M10 16a8 8 0 0 1 0-12M14 10h3"/>`),
	Controller: drawingIcon(`<rect ${iconStroke} x="4" y="5" width="12" height="10"/><path ${iconStroke} d="M7 10h6M10 7v6"/>`),
	"Signal Arrow": drawingIcon(`<path ${iconStroke} d="M3 10h12M11 6l4 4-4 4"/><path ${iconStroke} d="M5 6v8"/>`),
	"Signal Line": drawingIcon(`<path ${iconStroke} d="M4 10h12"/><circle ${iconStroke} cx="3" cy="10" r="1"/><circle ${iconStroke} cx="17" cy="10" r="1"/>`),
	Point: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="2"/>`),
	Function: drawingIcon(`<path ${iconStroke} d="M4 14c2-8 4 4 6-3s4-5 6-5"/>`),
	Vector: drawingIcon(`<path ${iconStroke} d="M4 15L15 4M10 4h5v5"/>`),
	Graph: drawingIcon(`<path ${iconStroke} d="M4 16V4M4 16h12M7 13l3-4 2 2 3-5"/>`),
	Equation: drawingIcon(`<path ${iconStroke} d="M4 6h4M6 4v4M10 10h6M4 15h4"/>`)
};

/*
 * Feature icons.
 *
 * The single authoritative icon for each feature type. The
 * toolbar reads the same artwork through toolIcons, and the
 * Feature Tree and the Features panel read it from here, so a
 * Particle or a Truss always shows the same symbol wherever it
 * appears. Every entry is a real feature type: a submenu
 * category such as Bodies or Loads is not a feature and has no
 * entry here, so no tree row is ever created for one.
 */
export const featureIcons = {
	point: toolIcons.Point,
	particle: toolIcons.Particle,
	"rigid-body": toolIcons["Rigid Body"],
	beam: toolIcons.Beam,
	truss: toolIcons.Truss,
	cable: toolIcons.Cable,
	shaft: toolIcons.Shaft,

	force: toolIcons["Point Load"],
	moment: toolIcons.Moment,

	load: toolIcons["Distributed Load"],
	"varying-load": toolIcons["Varying Distributed Load"],

	"pin-support": toolIcons["Pin Support"],
	"roller-support": toolIcons["Roller Support"],
	"fixed-support": toolIcons["Fixed Support"],
	"smooth-support": toolIcons["Smooth Support"],

	"pin-connection": toolIcons["Pin Connection"],
	"fixed-connection": toolIcons["Fixed Connection"],
	"slider-connection": toolIcons["Slider Connection"],

	"coordinate-system-2d": toolIcons["Coordinate System"],

	    /*
	     * THE FLUIDS FLOW PATHS.
	     *
	     * A run and an elbow each own a distinct symbol, so the two kinds of row a
	     * Flow Paths drawing produces in the Features list are told apart by their
	     * icons as well as their names. Both come from the SAME toolbar art the
	     * tool buttons use, so a feature cannot be filed under a different glyph
	     * from the tool that drew it.
	     */
	    "pipe-duct": toolIcons["Pipe / Duct"],
	    elbow: toolIcons.Elbow,
	    /*
	     * AND EVERY SCHEMATIC FLOIDS TYPE wears its own tool's artwork too, so a
	     * Pump in the Objects list is the Pump button and a Pressure Profile is
	     * the graph button - the same picture wherever the object appears.
	     */
	    "reducer-expander": toolIcons["Reducer / Expander"],
	    "reservoir-tank": toolIcons["Reservoir / Tank"],
	    pump: toolIcons.Pump,
	    valve: toolIcons.Valve,
	    "flow-meter": toolIcons["Flow Meter"],
	    "fluid-level": toolIcons["Fluid Level"],
	    "flow-direction-diagram": toolIcons["Flow Direction Diagram"],
	    "flow-profile": toolIcons["Flow Profile"],
	    "pressure-profile": toolIcons["Pressure Profile"],
	    "section-plane": toolIcons["Section Plane"],

	    /*
	     * A JUNCTION USES THE SAME ART AS ITS TOOL BUTTON, so a generated and a
	     * hand-placed junction file under one glyph.
	     */
	    junction: toolIcons.Junction
	};

export const drawingToolGroups = [
	{
		id: "selection",
		label: "Selection",
		tools: [{ id: "select", label: "Select", shortcut: "Esc" }]
	},
	{
		id: "geometry",
		label: "Create",
		tools: [
			{ id: "point", label: "Point", shortcut: "P" },
			{ id: "line", label: "Line", shortcut: "L" },
			{ id: "triangle", label: "Triangle", shortcut: "T" },
			{ id: "rectangle", label: "Rectangle", shortcut: "R" },
			{ id: "circle", label: "Circle", shortcut: "C" },
			/*
			 * Arc and Polygon each have two construction methods, shown as an
			 * expandable list under the tool - the same layout Statics uses for
			 * its grouped tools (see expandedToolbarSections).
			 */
			{ id: "arc", label: "Arc", shortcut: "A", submenu: true },
			{ id: "polygon", label: "Polygon", shortcut: "G", submenu: true },
			{ id: "freeform-polygon", label: "Freeform Polygon", shortcut: "F" }
		]
	},
	{
		id: "construction",
		label: "Construction",
		tools: [{ id: "coordinate-system", label: "Coordinate System" }]
	}
];

/*
 * ========================================================
 * ANNOTATE: THE TOOL GROUPS
 * ========================================================
 *
 * Annotate is an ENGINEERING-DRAWING discipline, and it is organised
 * EXACTLY the way Statics is: a short list of category headings, each with
 * its commands listed directly underneath. The two are deliberately the
 * same shape, because a student who has learned where a Statics tool lives
 * should not have to learn a second arrangement for an Annotate one.
 *
 *     SELECTION     the shared selection system, offered first
 *
 *     CREATE        every annotate command, listed directly
 *
 * THERE IS NO SUB-CATEGORY LEVEL, AND THAT IS THE WHOLE POINT.
 *
 * A tool is a COMMAND. A command that is behind another command is a
 * command the student has to go looking for, and the words for the kinds of
 * annotation - Dimensions, Text, Leader - are descriptions, not places. So
 * there is no "Dimensions -> Dimension", no caret, no flyout and no
 * hover menu: Dimension and the other annotate commands are VISIBLE AND
 * CLICKABLE THE MOMENT Annotate is selected.
 *
 * This mirrors Statics exactly. Bodies, Loads and Supports open menus there
 * because each one is a FAMILY OF FEATURES with genuinely different
 * geometry - a pin support and a roller support are different drawings - so
 * choosing between them is a real step. Annotate's commands are not like
 * that: a Dimension and a Leader are two separate tools with two separate
 * buttons, and grouping them behind a parent would add a click and hide a
 * command without deciding anything.
 *
 * THE TOOL IDS ARE DELIBERATELY THE FEATURE KINDS.
 *
 * `note`, `label`, `leader`, `callout`, `arrow`, `symbol`, `tolerance`,
 * `table` are the ids the creation layer and the panel both key on, so a
 * tool and the feature it makes cannot drift apart: there is one word for
 * each thing. `dimension` is the single dimension tool: the retired Smart
 * Dimension and Variable Dimension tools are no longer part of it.
 */
export const annotateToolGroups = [
	{
		id: "annotate-selection",
		label: "Selection",
		tools: [{ id: "select", label: "Select", shortcut: "Esc" }]
	},

	/*
	 * ========================================================
	 * ORGANISED BY WHAT AN ANNOTATION DOES
	 * ========================================================
	 *
	 * A single "Create" heading holding all ten commands was too broad:
	 * a measurement, a piece of writing, a leader and a table are
	 * fundamentally different KINDS of annotation, and a student looking for
	 * one had to read the whole list to find it. The categories below answer
	 * the question the student actually arrives with:
	 *
	 *     Need a measurement?              Dimensions
	 *     Need writing?                    Text
	 *     Need to point at geometry?       Leaders
	 *     Need a free arrow?               Markup
	 *     Need a symbol or a tolerance?    Symbols & Tolerances
	 *     Need a table?                    Tables
	 *
	 * THESE ARE CATEGORIES, NOT SUBMENUS.
	 *
	 * Every tool is listed DIRECTLY under its category and is clickable the
	 * moment Annotate is selected. There is no caret, no flyout and no
	 * second level: the hierarchy stops at Annotate -> Category -> Tool,
	 * exactly as it does in Statics. The `submenu` flag is therefore absent
	 * from every entry here - it is the flag Geometry and Statics use for
	 * the tools that DO open a menu (Arc, Bodies, Loads), and leaving it off
	 * is what makes each of these activate immediately.
	 *
	 * The headings are Organise, not Hide: a category is a place to look,
	 * never a step to complete.
	 */
	{
		id: "annotate-dimensions",
		label: "Dimensions",
		tools: [{ id: "dimension", label: "Dimension" }]
	},
	{
		id: "annotate-text",
		label: "Text",
		tools: [
			{ id: "note", label: "Note / Text" },
			{ id: "label", label: "Label" }
		]
	},
	{
		id: "annotate-leaders",
		label: "Leaders",
		tools: [
			{ id: "leader", label: "Leader" },
			{ id: "callout", label: "Callout" }
		]
	},

	/*
	 * ========================================================
	 * SYMBOLS - and the two V1 EXCLUSIONS
	 * ========================================================
	 *
	 * The standalone ARROW and TOLERANCE tools are NOT part of V1. Both are
	 * removed from the TOOLSET here, and from the toolset only.
	 *
	 * THE FEATURE KINDS REMAIN. `arrow` and `tolerance` are still declared in
	 * annotate-model.js and still render, select, move, save and load - so a
	 * drawing made with an earlier version keeps working, and the arrowheads the
	 * task explicitly keeps (Leader and Callout endpoint symbols) are untouched.
	 * Removing the kinds would have broken existing files; removing the TOOLS
	 * takes the entry out of the V1 menu and nothing else.
	 *
	 * Markup is gone as a heading for the same reason: with Arrow out of V1 it
	 * would be a category holding no command.
	 */
	{
		id: "annotate-symbols",
		label: "Symbols",
		tools: [{ id: "symbol", label: "Symbol" }]
	},
	{
		id: "annotate-tables",
		label: "Tables",
		tools: [{ id: "table", label: "Table" }]
	}
];

/*
 * Disciplines that are organised into labelled sections,
 * mirroring how the Geometry tools are grouped.
 *
 * Each entry lists section groups in display order. The
 * section labels match the wording used in the tool
 * panel headings.
 */
export const disciplineToolGroups = {
	ANNOTATE: annotateToolGroups,
	"SOLID MECHANICS": [
		{
			id: "solid-mechanics-selection",
			label: "Selection",
			tools: [{ id: "select", label: "Select", shortcut: "Esc" }]
		},
		{
			id: "solid-mechanics-create",
			label: "Create",
			tools: [
				{ id: "beam", label: "Beam" },
				{ id: "support", label: "Supports", submenu: true },
				{ id: "load", label: "Loads", submenu: true }
			]
		},
		{
			id: "solid-mechanics-analysis",
			label: "Analysis",
			tools: [
				{ id: "stress-element", label: "Stress Element" },
				{ id: "boundary-stress", label: "Boundary Stress" }
			]
		},
		{
			id: "solid-mechanics-reference",
			label: "Reference",
			tools: [{ id: "coordinate-system", label: "Coordinate System" }]
		}
	],

	/*
	 * ========================================================
	 * DYNAMICS: THE TOOLSET, IMPORTED FROM ITS OWN MODULE
	 * ========================================================
	 *
	 * The same arrangement FLUIDS uses below: the groups are declared in
	 * features/workspace/dynamics/dynamics-hierarchy.js, beside the tools
	 * and the model that read them, so a Dynamics tool is registered once.
	 */
	DYNAMICS: dynamicsToolGroups,

	/*
	 * ========================================================
	 * FLUIDS: THE TOOLSET, IMPORTED FROM ITS OWN MODULE
	 * ========================================================
	 *
	 * Fluids is organised the way Statics is - the same four sections, with
	 * their commands listed directly underneath, and its groups live in
	 * features/workspace/model/fluids/fluids-tools.js rather than in this file.
	 *
	 * The reason is MODULARITY, and it is the requirement's own: a Fluid
	 * tool is registered ONCE, beside the capability it travels, so
	 * adding, moving or building out a fluid-mechanics tool is an edit in
	 * one place. Listing the seventeen entries here as well would be a
	 * second copy of the section, free to fall out of step with the first.
	 *
	 * This is the SAME arrangement the other disciplines use - they are
	 * registered in this map and their tools travel the shared pipeline.
	 */
	FLUIDS: fluidsToolGroups,

	THERMODYNAMICS: [
		{
			id: "thermodynamics-selection",
			label: "Selection",
			tools: [{ id: "select", label: "Select", shortcut: "Esc" }]
		},
		{
			id: "thermodynamics-create",
			label: "Create",
			tools: [
				{ id: "tank", label: "Tank" },
				{ id: "steady-state-devices", label: "Steady-State Devices", iconLabel: "Turbine / Compressor", submenu: true },
				{ id: "control-volume", label: "Control Volume" },
				{ id: "piston-cylinder", label: "Piston Cylinder", submenu: true },
				{ id: "process-diagrams", label: "Process Diagrams", submenu: true },
				{ id: "heat-transfer", label: "Heat Transfer", submenu: true },
				{ id: "work", label: "Work", submenu: true }
			]
		},
		{
			id: "thermodynamics-analysis",
			label: "Analysis",
			tools: [
				{ id: "thermodynamic-cycles", label: "Thermodynamic Cycles", submenu: true }
			]
		},
		{
			id: "thermodynamics-reference",
			label: "Reference",
			tools: [
				{ id: "coordinate-system", label: "Coordinate System" }
			]
		}
	],

	STATICS: [
		{
			id: "statics-selection",
			label: "Selection",
			tools: [{ id: "select", label: "Select", shortcut: "Esc" }]
		},
		{
			id: "statics-create",
			label: "Create",
			tools: [
				{ id: "body", label: "Bodies", submenu: true },

				{ id: "load", label: "Loads", submenu: true },
				{ id: "moment", label: "Moment" },
				{ id: "support", label: "Supports", submenu: true },
				{ id: "connection", label: "Connections", submenu: true }
			]
		},
		{
			id: "statics-analysis",
			label: "Analysis",

			/*
			 * The Analysis section is DOCUMENTATION, not a solver.
			 *
			 * Every tool here helps the student draw, label and
			 * organise their own reasoning: resolve a force they
			 * have already drawn, combine vectors they have
			 * already placed, or open a frame to draw a
			 * shear/moment/axial diagram inside. None of them
			 * works out an unknown, and none reports a solution.
			 *
			 * Equilibrium and Moment Analysis were removed for
			 * that reason. Both read the student's forces and
			 * print a verdict - "not balanced, ΣFx ..." - which
			 * is a first step into doing the exercise for them,
			 * and it is exactly the step the exercise exists to
			 * make. They are not replaced with anything: if a
			 * genuine analysis module is built later it will earn
			 * its place here, rather than these two standing in
			 * for it.
			 */
			/*
			 * The diagram names carry their abbreviation in the
			 * LABEL as well as the icon, because the abbreviation
			 * is what the student will say and search for, and
			 * because the full names wrap to three lines in a
			 * narrow panel - which pushes the last tool in the
			 * section out of sight.
			 *
			 * The names are shortened rather than abbreviated to
			 * the point of being cryptic: "Shear Force (SFD)" is
			 * still readable on its own, and it is what a student
			 * would call it in a report.
			 */
			tools: [
				{ id: "resultant", label: "Resultant" },
				{ id: "force-components", label: "Force Components" },
				{ id: "shear-force-diagram", label: "Shear Force (SFD)" },
				{ id: "bending-moment-diagram", label: "Bending Moment (BMD)" },
				{ id: "axial-force-diagram", label: "Axial Force (AFD)" }
			]
		},
		{
			id: "statics-reference",
			label: "Reference",
			tools: [
				{ id: "coordinate-system", label: "Coordinate System" },
				{ id: "reference-point", label: "Reference Point" },
				{ id: "reference-line", label: "Reference Line" },

				/*
				 * Reference Arc.
				 *
				 * An ARC construction that produces construction
				 * geometry, in the same way the Reference Line
				 * produces construction linework.
				 *
				 * It is a separate tool rather than a mode of
				 * Geometry → Arc because the two make different
				 * things: one is final geometry a student drew,
				 * the other is reference geometry a student
				 * worked from. But the INTERACTION is the same code
				 * - the same construction modes, snapping, preview
				 * and editing - so it feels identical to use, and
				 * only the finished feature differs.
				 */
				{ id: "reference-arc", label: "Reference Arc", submenu: true }
			]
		}
	]
};

const globalToolGroups = [
	{
		id: "modify",
		label: "Modify",
		tools: [
			{ id: "move", label: "Move" },
			{ id: "rotate", label: "Rotate" },
			{ id: "mirror", label: "Mirror" },
			{ id: "trim", label: "Trim" },
			{ id: "extend", label: "Extend" }
		]
	},
	{
		id: "view",
		label: "View",
		tools: [
			{ id: "pan", label: "Pan" },
			{ id: "zoom", label: "Zoom" },
			{ id: "fit", label: "Fit" }
		]
	}
];

const sidebarToolDefinitions = drawingToolGroups.flatMap(group => group.tools);
const globalToolDefinitions = globalToolGroups.flatMap(group => group.tools);
export const drawToolDefinitions = [
	...sidebarToolDefinitions,
	...globalToolDefinitions
];
export const drawToolLabelById = Object.fromEntries(drawToolDefinitions.map(tool => [tool.id, tool.label]));

export const engineeringTools = {
	GEOMETRY: sidebarToolDefinitions.map(tool => tool.label),
	ANNOTATE: ["Dimension", "Note / Text", "Label", "Leader", "Callout", "Symbol", "Table"],
	STATICS: ["Particle", "Rigid Body", "Beam", "Truss", "Cable", "Shaft", "Point Load", "Distributed Load", "Varying Distributed Load", "Moment", "Pin Support", "Roller Support", "Fixed Support", "Smooth Support", "Pin Connection", "Fixed Connection", "Slider Connection", "Free Body Diagram"],
	DYNAMICS: ["Particle", "Rigid Body", "Velocity", "Acceleration", "Rotation", "Motion Path"],
	/*
	 * FLUIDS is a GROUPED toolset now - see `disciplineToolGroups.FLUIDS`,
	 * imported from features/fluids/fluids-tools.js - so this flat list is no
	 * longer what the toolbar renders. It is kept in step because it is the
	 * validity gate `renderEngineeringTools` reads and the list the
	 * documentation and the inventory QA quote, and a stale copy here would
	 * describe a section that no longer exists.
	 *
	 * The names are the LABELS from the registry, in the order the sidebar
	 * shows them, with Select omitted: the flat branch prepends Select itself,
	 * exactly as it does for every other discipline. The two dropdown PARENTS
	 * are named here and their children are not, because that is what the
	 * section lists - the children are behind the menu, and this list would
	 * describe an arrangement nobody sees if it flattened them in.
	 */
	FLUIDS: [
		"Flow Paths",
		"Reducer / Expander",
		"Reservoir / Tank",
		"Pump",
		"Valve",
		"Flow Meter",
		"Flow Indicators & Annotations",
		"Flow Direction Diagram",
		"Flow Profile",
		"Pressure Profile",
		"Coordinate System",
		"Reference Point",
		"Reference Line",
		"Section Plane"
	],
	THERMODYNAMICS: ["Tank", "Control Volume", "Piston Cylinder", "Process Diagrams", "Heat Transfer", "Work"],
	"HEAT TRANSFER": ["Wall", "Layer", "Heat Flux", "Temperature", "Convection", "Radiation"],
	"SOLID MECHANICS": ["Stress Element", "Boundary Stress", "Beam", "Supports", "Load", "Coordinate System"],
	"MECHANICAL DESIGN": ["Part", "Hole", "Gear", "Fastener", "Section View"],
	CONTROLS: ["Plant", "Block", "Input", "Output", "Sensor", "Controller", "Signal Line"],
	"MATH / ANALYSIS": ["Point", "Function", "Vector", "Graph", "Equation"]
};
