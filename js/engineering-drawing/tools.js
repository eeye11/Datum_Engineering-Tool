const drawingIcon = content => `<svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">${content}</svg>`;
const iconStroke = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';

const toolIcons = {
	Select: drawingIcon(`<path ${iconStroke} d="M4 3l3 12 3-4 4 4 1-1-4-4 5-1z"/>`),
	Line: drawingIcon(`<path ${iconStroke} d="M4 16L16 4"/>`),
	Polyline: drawingIcon(`<path ${iconStroke} d="M3 14l4-8 5 5 5-7"/><circle ${iconStroke} cx="3" cy="14" r="1"/><circle ${iconStroke} cx="7" cy="6" r="1"/><circle ${iconStroke} cx="12" cy="11" r="1"/>`),
	Arc: drawingIcon(`<path ${iconStroke} d="M4 14a7 7 0 0 1 10-9"/><path ${iconStroke} d="M13 5h2v2"/>`),
	Circle: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="6"/>`),
	Rectangle: drawingIcon(`<rect ${iconStroke} x="4" y="5" width="12" height="10"/>`),
	"Construction Geometry": drawingIcon(`<path ${iconStroke} stroke-dasharray="2 2" d="M3 15L17 5"/>`),
	Move: drawingIcon(`<path ${iconStroke} d="M10 3v14M3 10h14M10 3l-2 2M10 3l2 2M10 17l-2-2M10 17l2-2M3 10l2-2M3 10l2 2M17 10l-2-2M17 10l-2 2"/>`),
	Rotate: drawingIcon(`<path ${iconStroke} d="M15 7a6 6 0 1 0 1 6"/><path ${iconStroke} d="M15 3v4h-4"/>`),
	Mirror: drawingIcon(`<path ${iconStroke} d="M10 3v14M4 6l4 4-4 4M16 6l-4 4 4 4"/>`),
	Trim: drawingIcon(`<path ${iconStroke} d="M4 5l11 10M15 5L4 15M3 10h6"/>`),
	Extend: drawingIcon(`<path ${iconStroke} d="M4 10h12M12 6l4 4-4 4M4 5v10"/>`),
	Pan: drawingIcon(`<path ${iconStroke} d="M6 10V6a1 1 0 0 1 2 0v3V4a1 1 0 0 1 2 0v5V5a1 1 0 0 1 2 0v4V6a1 1 0 0 1 2 0v6c0 3-2 5-5 5-2 0-3-1-4-3l-1-2a1 1 0 0 1 2-1z"/>`),
	Zoom: drawingIcon(`<circle ${iconStroke} cx="8.5" cy="8.5" r="4.5"/><path ${iconStroke} d="M12 12l4 4M8.5 6v5M6 8.5h5"/>`),
	"Smart Dimension": drawingIcon(`<path ${iconStroke} d="M4 6l2-2 2 2M6 4v12M4 14l2 2 2-2M11 5h5M11 10h4M11 15h5"/>`),
	"Note / Text": drawingIcon(`<path ${iconStroke} d="M4 4h12v9H9l-4 3v-3H4zM7 7h6M7 10h4"/>`),
	Leader: drawingIcon(`<path ${iconStroke} d="M4 15L15 5M12 5h4v4"/><circle ${iconStroke} cx="4" cy="15" r="1"/>`),
	Arrow: drawingIcon(`<path ${iconStroke} d="M4 16L16 4M11 4h5v5"/>`),
	Callout: drawingIcon(`<path ${iconStroke} d="M4 4h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path ${iconStroke} d="M6 7h5M6 10h3"/>`),
	Symbol: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="6"/><path ${iconStroke} d="M7 10h6M10 7v6"/>`),
	Tolerance: drawingIcon(`<rect ${iconStroke} x="3" y="5" width="14" height="10"/><path ${iconStroke} d="M6 8l2 2-2 2M11 8h3M11 12h3"/>`),
	Table: drawingIcon(`<rect ${iconStroke} x="3" y="4" width="14" height="12"/><path ${iconStroke} d="M3 8h14M3 12h14M8 4v12M13 4v12"/>`),
	Reference: drawingIcon(`<path ${iconStroke} d="M4 4h12v12H4zM7 7h6M7 10h6M7 13h3"/>`),
	"Coordinate System": drawingIcon(`<path ${iconStroke} d="M4 16V4M4 16h12M4 16l3-3M4 16l3 1M16 16l-3-3M16 16l-3 1"/>`),
	Force: drawingIcon(`<path ${iconStroke} d="M10 16V4M10 4L7 7M10 4l3 3M5 16h10"/>`),
	Moment: drawingIcon(`<path ${iconStroke} d="M6 14a6 6 0 1 1 7-9M13 5h3v3M10 10l3-3"/>`),
	Support: drawingIcon(`<path ${iconStroke} d="M4 15h12M6 15l4-7 4 7M4 17h12"/>`),
	Beam: drawingIcon(`<path ${iconStroke} d="M3 7h14v6H3zM6 7v6M14 7v6"/>`),
	Load: drawingIcon(`<path ${iconStroke} d="M10 3v11M7 11l3 3 3-3M5 17h10"/>`),
	"Free Body Diagram": drawingIcon(`<rect ${iconStroke} x="5" y="5" width="10" height="10"/><path ${iconStroke} d="M10 2v3M10 15v3M2 10h3M15 10h3"/>`),
	Particle: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="2"/><path ${iconStroke} d="M10 3v5M10 12v5M3 10h5M12 10h5"/>`),
	"Rigid Body": drawingIcon(`<rect ${iconStroke} x="5" y="5" width="10" height="10"/><circle ${iconStroke} cx="10" cy="10" r="2"/>`),
	Velocity: drawingIcon(`<path ${iconStroke} d="M3 14h12M11 7l5 7-5 1"/>`),
	Acceleration: drawingIcon(`<path ${iconStroke} d="M3 14h12M11 6l5 8-5 2"/><path ${iconStroke} d="M6 8l3-3"/>`),
	Rotation: drawingIcon(`<path ${iconStroke} d="M15 7a6 6 0 1 0 1 6M15 3v4h-4"/>`),
	"Motion Path": drawingIcon(`<path ${iconStroke} d="M3 14c3-8 8 5 14-6"/><circle ${iconStroke} cx="3" cy="14" r="1"/><circle ${iconStroke} cx="17" cy="8" r="1"/>`),
	Pipe: drawingIcon(`<path ${iconStroke} d="M4 5v8a3 3 0 0 0 3 3h9M4 5h4M12 16v-5a2 2 0 0 1 2-2h2"/>`),
	Reservoir: drawingIcon(`<path ${iconStroke} d="M4 6h12v9H4zM4 9h12M7 4v2M13 4v2"/>`),
	Valve: drawingIcon(`<path ${iconStroke} d="M3 10h5l2-3 2 3h5M8 14l2-4 2 4M10 7V4"/>`),
	Pump: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="5"/><path ${iconStroke} d="M10 5v5l3 2M3 10h2M15 10h2"/>`),
	"Flow Arrow": drawingIcon(`<path ${iconStroke} d="M3 10h12M11 6l4 4-4 4"/>`),
	Pressure: drawingIcon(`<circle ${iconStroke} cx="10" cy="11" r="6"/><path ${iconStroke} d="M10 11l3-3M7 4h6"/>`),
	"Control Volume": drawingIcon(`<rect ${iconStroke} x="4" y="5" width="12" height="10" stroke-dasharray="2 2"/><path ${iconStroke} d="M2 10h2M16 10h2"/>`),
	"System Boundary": drawingIcon(`<rect ${iconStroke} x="4" y="4" width="12" height="12" stroke-dasharray="3 2"/>`),
	"State Point": drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="2"/><path ${iconStroke} d="M10 3v5M10 12v5M3 10h5M12 10h5"/>`),
	"Process Path": drawingIcon(`<path ${iconStroke} d="M3 14c3-7 5 4 8-2s4-3 6-6"/><path ${iconStroke} d="M14 6h3v3"/>`),
	"Heat Transfer": drawingIcon(`<path ${iconStroke} d="M4 5c5 2 7 8 12 10M4 10c5 2 7 3 12 5"/>`),
	Work: drawingIcon(`<path ${iconStroke} d="M4 15h12M6 15V8h8v7M8 8V5h4v3"/>`),
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
	Input: drawingIcon(`<path ${iconStroke} d="M3 10h10M10 6l4 4-4 4"/>`),
	Output: drawingIcon(`<path ${iconStroke} d="M17 10H7M10 6l-4 4 4 4"/>`),
	Sensor: drawingIcon(`<path ${iconStroke} d="M6 14a6 6 0 0 1 0-8M10 16a8 8 0 0 1 0-12M14 10h3"/>`),
	Controller: drawingIcon(`<rect ${iconStroke} x="4" y="5" width="12" height="10"/><path ${iconStroke} d="M7 10h6M10 7v6"/>`),
	"Signal Arrow": drawingIcon(`<path ${iconStroke} d="M3 10h12M11 6l4 4-4 4"/><path ${iconStroke} d="M5 6v8"/>`),
	Point: drawingIcon(`<circle ${iconStroke} cx="10" cy="10" r="2"/>`),
	Function: drawingIcon(`<path ${iconStroke} d="M4 14c2-8 4 4 6-3s4-5 6-5"/>`),
	Vector: drawingIcon(`<path ${iconStroke} d="M4 15L15 4M10 4h5v5"/>`),
	Graph: drawingIcon(`<path ${iconStroke} d="M4 16V4M4 16h12M7 13l3-4 2 2 3-5"/>`),
	Equation: drawingIcon(`<path ${iconStroke} d="M4 6h4M6 4v4M10 10h6M4 15h4"/>`)
};

const drawingToolGroups = [
	{
		id: "selection",
		label: "Selection",
		tools: [{ id: "select", label: "Select", shortcut: "Esc" }]
	},
	{
		id: "geometry",
		label: "Create",
		tools: [
			{ id: "line", label: "Line", shortcut: "L" },
			{ id: "polyline", label: "Polyline", shortcut: "P" },
			{ id: "circle", label: "Circle", shortcut: "C" },
			{ id: "arc", label: "Arc", shortcut: "A" },
			{ id: "rectangle", label: "Rectangle" }
		]
	},
	{
		id: "construction",
		label: "Construction",
		tools: [{ id: "construction", label: "Construction Geometry" }]
	},
	{
		id: "reference",
		label: "Reference",
		tools: [{ id: "coordinate-system", label: "Coordinate System" }]
	},
	{
		id: "modify",
		label: "Edit",
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
			{ id: "zoom", label: "Zoom" }
		]
	}
];

const drawToolDefinitions = drawingToolGroups.flatMap(group => group.tools);
const drawToolLabelById = Object.fromEntries(drawToolDefinitions.map(tool => [tool.id, tool.label]));

const engineeringTools = {
	GEOMETRY: drawToolDefinitions.map(tool => tool.label),
	ANNOTATE: ["Smart Dimension", "Note / Text", "Leader", "Arrow", "Callout", "Symbol", "Tolerance", "Table", "Reference"],
	STATICS: ["Force", "Moment", "Support", "Beam", "Load", "Free Body Diagram"],
	DYNAMICS: ["Particle", "Rigid Body", "Velocity", "Acceleration", "Rotation", "Motion Path"],
	FLUIDS: ["Pipe", "Reservoir", "Valve", "Pump", "Flow Arrow", "Pressure"],
	THERMODYNAMICS: ["Control Volume", "System Boundary", "State Point", "Process Path", "Heat Transfer", "Work"],
	"HEAT TRANSFER": ["Wall", "Layer", "Heat Flux", "Temperature", "Convection", "Radiation"],
	"SOLID MECHANICS": ["Beam", "Shaft", "Load", "Stress", "Strain", "Boundary Condition"],
	"MECHANICAL DESIGN": ["Part", "Hole", "Shaft", "Gear", "Fastener", "Section View"],
	CONTROLS: ["Block", "Input", "Output", "Sensor", "Controller", "Signal Arrow"],
	"MATH / ANALYSIS": ["Point", "Function", "Vector", "Graph", "Equation"]
};
