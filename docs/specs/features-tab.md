# DAETUM — Global Features Tab, Object Selection, Transform, and Geometry Feature Specification

## 1. Objective and scope

Implement DAETUM's global Features tab as the universal editing panel for selected objects across the entire application.

**The Features tab is not a Geometry-only panel.** It must support every applicable object type from every tool category, including:

- Geometry
- Annotate
- Statics
- Dynamics
- Fluids
- Thermodynamics
- Heat Transfer
- Solid Mechanics
- Mechanical Design
- Controls
- Math / Analysis

These categories must continue to expose their own relevant properties. Geometry-specific settings described in this specification apply only to the corresponding Geometry objects. They must not replace, remove, or restrict the existing feature definitions for other categories.

The universal Features behaviour, including multi-selection, mixed property values, object-level editing, and Transform, must follow the rules in this specification across the application wherever the relevant object supports the operation.

DAETUM is a freeform engineering drawing and schematic editor, not a CAD application. Keep the interface compact, predictable, and appropriate for students.

Reuse the current application architecture, object model, tool implementations, rendering system, snapping behaviour, and source integration. Modify existing functionality where necessary instead of unnecessarily rewriting working tools.

## 2. Right-side panel structure

The right-side panel must contain exactly three tabs:

**Objects | Features | Source**

Do not introduce a separate Properties tab.

### 2.1 Objects tab

The Objects tab displays a clean inventory of all objects on the current sheet, regardless of the tool category that created them.

Every object row must contain:
- A small icon representing its object type.
- The existing object name or label, where available.
- A selection highlight when selected.

Use recognisable, consistent icons for Geometry shapes, annotations, statics objects, dynamics objects, fluid-system objects, thermal objects, solid-mechanics objects, mechanical-design objects, control-system objects, mathematical objects, and other supported object types.

Use the appropriate existing object identity and type information. Do not give every object the same generic icon.

Selecting a row must select the corresponding object on the canvas. Selecting an object on the canvas must highlight its corresponding row in Objects.

Support single and multiple selection through the application's existing selection gestures and commands. Every selected row must visibly indicate its selection state.

Do not display properties, editable settings, or property summaries underneath the inventory. The Objects tab is strictly an object list.

### 2.2 Features tab

The Features tab is the universal editing interface for currently selected objects from all tool categories.

**When nothing is selected, the Features tab must be completely empty.**

Do not display:
- Tool defaults.
- Default appearance settings.
- Disabled property fields.
- Empty instructional placeholders.
- Construction-method controls.
- Unselected-tool settings.

Activating a drawing tool does not count as selecting an object.

When one object is selected, display that object's applicable editable properties.

When multiple objects are selected, display all applicable editable properties for the selected objects according to the multi-selection rules in Section 3.

The Features tab must identify and display the properties that apply to the current selection, rather than assuming that every selected object belongs to Geometry or shares the same object type.

Organise the available properties under concise, relevant headings. Examples include:

- Marker
- Line
- Shape
- Fill
- Axes
- Labels
- Appearance
- Object
- Transform

Show only the headings and controls relevant to the current selection. Do not insert empty sections simply to keep every object panel identical.

Do not use generic section headings such as Settings or Controls.

Do not introduce a Construction section or Construction Method selector into the Geometry Features panels.

Creation defaults must remain managed by the application's existing tool or default-setting mechanisms, not by displaying unselected tool properties in Features.

### 2.3 Source tab

The Source tab displays the actual editable LaTeX drawing source used by DAETUM.

It must work with the complete drawing, not just Geometry objects.

Selecting any source-backed object must highlight:
- The object in the canvas.
- Its row in Objects.
- The corresponding source region when Source is open.

For multiple selections, highlight every corresponding object and source region.

Editing valid source must update the drawing through the existing renderer. GUI changes to selected objects must update the appropriate underlying source.

Use DAETUM's chosen non-TikZ LaTeX drawing format. Do not introduce TikZ-specific syntax, dependencies, or unsupported commands. Do not reintroduce the discarded `.enggdraw` file format.

Preserve the existing source-generation and parsing architecture for the different tool categories.

## 3. Universal multi-selection and property behaviour

This section applies to all tool categories, not just Geometry.

### 3.1 Displaying properties for different object types

When multiple objects are selected, the Features tab must show the properties that are applicable to the selected objects.

The selected objects do not need to belong to the same tool category.

A property may apply to:
- Every selected object.
- Only objects of a particular type.
- A compatible subset of selected objects.
- Objects with equivalent underlying properties represented by a common field.

For example:

- Several Lines can be edited together for line style, arrow types, colour, and thickness.
- A Line and Circle can be edited together for compatible shared appearance properties.
- A selection of regular Polygons can expose Number of Sides.
- A mixed selection containing Polygons and unrelated objects may still expose Number of Sides for the selected regular Polygons only.
- Selected annotations may expose text properties that do not apply to other selected objects.
- Selected Statics or Fluids objects must retain their own relevant engineering properties without introducing unrelated Geometry controls.
- Selected objects from different categories can expose a compatible shared property when that property genuinely applies to each of them.

Preserve each tool's existing property definitions and behaviour. Do not invent arbitrary properties for other categories simply to make their Features panels resemble Geometry.

### 3.2 Different property values among selected objects

If multiple selected objects support the same property but have different values, the corresponding field must appear empty or in an appropriate mixed-value state.

Never display one object's value as though it represents the entire selection.

Examples include:

- Different colours: the Colour field shows a mixed state.
- Different thicknesses: the Thickness field shows a mixed state.
- Different fill modes: the Fill control shows a mixed state.
- Different labels: the applicable text input is empty.
- Different Fixed states: the Fixed control shows an indeterminate state.
- Different Polygon side counts: Number of Sides is empty.
- Different line styles or arrow types: the applicable controls show mixed values.

For colour pickers and swatches, provide a clear mixed-value presentation rather than selecting an arbitrary object's colour.

For dropdowns, toggles, checkboxes, and text fields, represent the mixed state appropriately.

An empty field representing mixed values must not be interpreted as an instruction to clear, reset, or overwrite the existing values.

Preserve each object's original value until the user deliberately enters a new value or chooses a new option.

### 3.3 Applying changes to a selection

When the user changes a property, apply the new value to every selected object that supports that property.

If the property applies only to a subset of the selection, modify only the compatible objects.

Do not modify unrelated properties on the same object. Do not alter geometry, appearance, or metadata belonging to objects that do not support the changed property.

For example, changing the outline colour of selected shapes must preserve each object's individual fill colour, fill mode, dimensions, labels, and other properties.

If objects have different values for unrelated properties, those differences must remain intact.

Changing one field must never silently reset other mixed fields.

The GUI, object model, rendering, and source must remain synchronised.

## 4. Universal Transform section

Transform is a shared editing feature for all selected drawable objects that support the corresponding transformations across DAETUM's tool categories.

All nine Geometry objects defined in this specification must support Transform. Objects from other categories must also expose applicable Transform controls wherever their underlying objects support movement or rotation.

Do not restrict Transform to Geometry merely because Geometry is the category being specified in detail here.

### 4.1 Transform fields

Display the following fields under the **Transform** heading:

- X Shift
- Y Shift
- Rotate

Each field must have:
- A numeric input.
- An up-arrow button.
- A down-arrow button.

Users must be able to enter values directly or use the arrow buttons for small adjustments.

Use compact, consistent controls that fit the existing Features panel.

### 4.2 Arrow increments

Each arrow click applies a transformation increment of exactly 0.1 in the appropriate direction.

**X Shift**
- Up arrow: increase X Shift by 0.1, moving the target to the right.
- Down arrow: decrease X Shift by 0.1, moving the target to the left.

**Y Shift**
- Up arrow: increase Y Shift by 0.1, moving the target upward.
- Down arrow: decrease Y Shift by 0.1, moving the target downward.

**Rotate**
- Up arrow: rotate by +0.1 degrees.
- Down arrow: rotate by −0.1 degrees.

X and Y shifts use DAETUM's internal drawing-space units. They are not physical dimensions and must not introduce unit selectors.

Rotate uses degrees.

Every arrow click must apply the corresponding transformation to the drawing, not merely change the displayed number.

### 4.3 Manual numeric entry

Allow direct numeric entry into all Transform fields.

An entered value represents the relative transformation amount to apply when committed. It is not an absolute coordinate and is not intended to display or declare the object's current location.

For example, entering 2 into X Shift applies a horizontal translation of 2 drawing-space units to the applicable selected target or targets.

Direct entry and arrow-based adjustment must use consistent transformation logic.

### 4.4 Transform reset behaviour

Transform inputs are temporary adjustment controls.

Whenever the user leaves and returns to the Transform section, reset the displayed X Shift, Y Shift, and Rotate input values to `0`.

This resets only the input fields. It must not undo, reverse, or reset transformations already applied to the drawing.

Do not restore previously entered adjustment values when reopening the section.

### 4.5 Multiple-selection transformations

When multiple transformable objects are selected:

- X Shift translates the applicable objects together horizontally.
- Y Shift translates the applicable objects together vertically.
- Rotate rotates the applicable selection as a group around the selection's centre.

Preserve the relative layout of the objects during group transformations.

For a single selected object, rotate around its centre unless that object's definition specifies a meaningful different pivot. An individually selected Coordinate System rotates around its defined origin.

Apply transformations only to objects that support the relevant operation.

Fixed objects must not move or rotate as a side effect of transforming other selected objects. For a mixed selection of fixed and unfixed objects, leave fixed objects unchanged and apply the operation only to transformable objects.

If every selected object is fixed, disable or prevent Transform actions until those objects are unfixed.

Do not show inappropriate transformation options on object types that fundamentally do not support them. Preserve their existing semantics and expose only applicable controls.

## 5. Common appearance controls

Use a consistent appearance vocabulary and control style wherever the relevant object types support these properties.

### Colour

Use a colour swatch and picker.

When selected objects have different colours, display a mixed state. Do not arbitrarily select one object's colour.

### Thickness

Use the following shared Thickness dropdown for applicable strokes and outlines:

| Option | Suggested width |
|---|---:|
| Very Thin | 0.75 px |
| Thin | 1 px |
| Normal | 1.5 px |
| Medium | 2.5 px |
| Thick | 4 px |
| Very Thick | 6 px |
| Custom | User-defined |

Normal is the default for newly created applicable Geometry objects.

Do not include Hairline.

When Custom is selected, show a numeric width input with a fixed `px` label. Do not provide a unit selector.

Allow values from 0.25 to 20 px in increments of 0.25 px.

Thickness controls must behave correctly for single and multiple selections. A mixed selection of thickness values must appear empty or mixed until the user selects a replacement.

Thickness must affect appearance only. It must not change endpoints, vertices, radius, coordinates, proportions, or other geometric properties.

Use the rendering system's supported stroke-width representation. Do not introduce TikZ-specific syntax.

### Fill

For fill-capable objects, use:

**Mode**
- None
- Solid

Show Fill Colour when Solid is selected for the relevant selected object or objects.

When selected objects have different fill modes, show a mixed state.

In a mixed-type selection, update fill properties only on selected objects that support them. Preserve unrelated properties and geometry.

### Common-control rule

Do not force all tool categories to expose Colour, Thickness, or Fill if those properties are not applicable to their objects. Preserve each category's existing property model and show only relevant controls.

## 6. Geometry-specific Features

The following detailed specifications describe the Geometry category only. They are one part of the universal Features tab, not the full definition of DAETUM's Features functionality.

### 6.1 Point

**Marker**
- Style: Dot / Cross.
- Size: Small / Medium / Large.

**Appearance**
- Colour.

**Object**
- Fixed.

**Transform**
- X Shift.
- Y Shift.
- Rotate.

Marker style and size affect visual appearance, not point position.

The point position is determined by its drawing gesture and resolved snapping position.

### 6.2 Line

**Line**
- Style: Solid / Dashed / Dotted.
- Begin Arrow Type: None / Open Arrow / Filled Arrow / Bar.
- End Arrow Type: None / Open Arrow / Filled Arrow / Bar.

Begin and End Arrow Type are independently configurable.

Begin Arrow Type applies to the first endpoint. End Arrow Type applies to the second endpoint.

Arrowheads and bars use the line's appearance colour.

Changing either arrow type must not move endpoints, change length, or alter geometry.

**Appearance**
- Colour.
- Thickness.

**Object**
- Fixed.

**Transform**
- X Shift.
- Y Shift.
- Rotate.

Do not include length, angle, physical dimensions, or numerical endpoint coordinate fields.

### 6.3 Triangle

**Fill**
- Mode: None / Solid.

**Appearance**
- Outline Colour.
- Thickness.
- Fill Colour when Solid is selected.

**Object**
- Fixed.

**Transform**
- X Shift.
- Y Shift.
- Rotate.

Students can draw triangles of any convenient visual proportions.

Do not include triangle classifications, angle constraints, equal-side constraints, or side-length inputs.

### 6.4 Rectangle

**Fill**
- Mode: None / Solid.

**Appearance**
- Outline Colour.
- Thickness.
- Fill Colour when Solid is selected.

**Object**
- Fixed.

**Transform**
- X Shift.
- Y Shift.
- Rotate.

Draw Rectangles by dragging between opposite corners. Holding Shift temporarily constrains the shape to a square.

Do not add width, height, aspect-ratio, or physical-dimension fields.

### 6.5 Circle

**Fill**
- Mode: None / Solid.

**Appearance**
- Outline Colour.
- Thickness.
- Fill Colour when Solid is selected.

**Object**
- Fixed.

**Transform**
- X Shift.
- Y Shift.
- Rotate.

The student presses at the centre, drags outward, and releases.

The radius is established by the gesture. Do not add a numerical radius input.

### 6.6 Arc

**Line**
- Style: Solid / Dashed / Dotted.

**Appearance**
- Colour.
- Thickness.

**Object**
- Fixed.

**Transform**
- X Shift.
- Y Shift.
- Rotate.

Retain both Arc construction methods in the existing tool activation or toolbar controls.

**Three Points**
- Establish the start point and endpoint.
- Drag to determine the curve.

**Centre–Start–End**
- Establish the centre and start point.
- Drag to establish the endpoint and sweep.

Do not include a Construction section or Method selector in Features.

After creation, display only applicable appearance properties, Fixed, and Transform.

Do not add numerical radius, arc-length, or angle fields.

### 6.7 Regular Polygon

**Shape**
- Number of Sides: integer stepper.
- Minimum: 3.
- Default: 6.

**Fill**
- Mode: None / Solid.

**Appearance**
- Outline Colour.
- Thickness.
- Fill Colour when Solid is selected.

**Object**
- Fixed.

**Transform**
- X Shift.
- Y Shift.
- Rotate.

Retain the Centre and Side methods through the existing tool activation or toolbar controls.

**Centre method:** Establish the centre and a radial point to determine visual size and orientation.

**Side method:** Use the dragged segment as an actual side of the polygon.

Do not show a Construction section or Method selector in Features.

Number of Sides must update a selected regular Polygon. The active preview must also respond to side-count changes through the existing drawing-tool controls when no object is selected.

In multi-selection, Number of Sides is empty when selected regular Polygons have different values. Changing the value updates all selected compatible regular Polygons.

Do not add radius, side-length, angle, coordinate, or unit inputs.

### 6.8 Freeform Polygon

**Fill**
- Mode: None / Solid.

**Appearance**
- Outline Colour.
- Thickness.
- Fill Colour when Solid is selected.

**Object**
- Fixed.

**Transform**
- X Shift.
- Y Shift.
- Rotate.

Vertices are placed through successive drawing gestures. Close the shape by snapping to the starting vertex.

When selected and unfixed, allow vertices to be edited.

Do not include a construction-method selector or Number of Sides field.

### 6.9 Coordinate System

**Axes**
- Show X-axis: On / Off.
- Show Y-axis: On / Off.

**Labels**
- Show Labels: On / Off.
- X-axis Label: text input, default `x`.
- Y-axis Label: text input, default `y`.
- Origin Label: text input, default `O`.

**Appearance**
- Colour.
- Thickness.

**Object**
- Fixed.

**Transform**
- X Shift.
- Y Shift.
- Rotate.

The student establishes the origin and orientation by dragging. The Y-axis is generated perpendicular to the X-axis.

Changing labels changes their text only. Hiding axes or labels must not move or reshape the coordinate system.

When selected Coordinate Systems have different label text, show an empty field for the corresponding label.

Do not add numerical ticks, coordinate inputs, units, grid intervals, or scale factors.

## 7. Other tool categories

The Features tab must continue supporting the properties of objects created by Annotate, Statics, Dynamics, Fluids, Thermodynamics, Heat Transfer, Solid Mechanics, Mechanical Design, Controls, Math / Analysis, and every other existing tool category.

Do not replace those categories' feature schemas with Geometry properties.

For every non-Geometry object:
- Retain its existing relevant editable properties.
- Show those properties when the object is selected.
- Include them in multi-selection property resolution when compatible.
- Display mixed values when selected objects differ.
- Apply changes only to selected objects that support the changed property.
- Preserve unrelated values and object metadata.
- Expose common Transform controls wherever the object supports movement or rotation.
- Preserve the object's existing rendering, calculation, and source integration behaviour.

Where a tool has specialised engineering properties, use the existing tool implementation to determine applicability, field meanings, dependencies, and valid values. Do not invent new engineering calculations or property fields as part of implementing this UI specification.

Do not make a selection of mixed object types behave as though all objects were Geometry objects.

## 8. Fixed behaviour

Every Geometry tool specified in Section 6 must support a Fixed option on selected objects.

The Features tab must not display a Create as Fixed setting when nothing is selected. It must remain empty.

When objects are selected, label the lock setting **Fixed**.

When enabled, Fixed prevents ordinary:
- Movement.
- Rotation.
- Resizing.
- Geometric reshaping.
- Vertex editing.

Fixed is a simple editing lock, not a CAD constraint system.

A fixed object must remain selectable, visible in Objects, available as a snapping target, editable in appearance, unlockable, and deletable through existing commands.

For multiple selections with different Fixed states, display an indeterminate state. Setting the control explicitly to on or off applies that state to all selected compatible objects.

Other tool categories must retain their existing locking or protection behaviour. Reuse the same Fixed mechanism for non-Geometry objects where compatible; do not break specialised objects or calculations by imposing inappropriate editing restrictions.

Fixed state must be stored in DAETUM's object model, not encoded as a nonstandard LaTeX command, and must persist through saving and reopening.

## 9. Shared snapping and freeform behaviour

Snapping is handled by DAETUM's shared Snap system, not by individual Features panels.

Grid Snap and Object Snap operate independently.

Turning Grid Snap off disables only grid alignment. Endpoint, midpoint, intersection, centre, quadrant, and point-on-entity snapping must continue working when Object Snap and the relevant snap modes are enabled.

Disabling snapping restores free cursor positioning without deleting, moving, or recalculating existing geometry.

Fixed objects remain valid snapping targets.

Do not add duplicate snapping controls to Geometry or other tool-specific Features panels.

## 10. Source integration and persistence

All supported object types must remain integrated with DAETUM's existing source, object-model, and rendering architecture.

Requirements:
- GUI property edits update the relevant object model and rendered output.
- Appearance edits update the correct source representation.
- Geometry edits update the corresponding drawing source.
- Specialised engineering-property changes retain the existing tool-specific behaviour.
- Transform changes modify actual object geometry or transformation state, not merely displayed fields.
- Selection synchronisation works across Objects, Features, Source, and the canvas.
- Multiple selection correctly highlights all corresponding objects and source regions.
- Saving and reopening preserve geometry, supported object properties, labels, transformations, and Fixed state.
- Valid source edits update the drawing through the existing renderer.
- Existing supported non-Geometry tools remain functional.
- The implementation does not introduce TikZ-specific syntax, unsupported LaTeX commands, or the discarded `.enggdraw` format.

Keep Fixed as object metadata rather than a nonstandard LaTeX command. Preserve identifiable object metadata when valid source edits modify the drawing, wherever the current architecture permits.

Do not rebuild the whole rendering pipeline if the existing implementation can be extended.

## 11. Acceptance criteria

### Global panel behaviour
- The right-side panel contains exactly Objects, Features, and Source.
- Features supports all tool categories, not only Geometry.
- Features is completely empty when nothing is selected.
- Selecting any supported object displays its applicable properties.
- Selecting multiple compatible or mixed-type objects displays relevant shared and type-specific properties.
- The Objects inventory shows appropriate object icons, names where available, and selection highlighting.
- Objects contains no property controls underneath the list.
- Selection is synchronised between the Objects list and canvas.
- No separate Properties tab is introduced.

### Mixed values
- Differing property values appear empty or in an explicit mixed state.
- Empty mixed fields do not erase existing object values.
- Changing a field updates only selected compatible objects.
- Unrelated properties retain their individual values.
- Tool-specific properties remain intact across all categories.

### Geometry
- All nine Geometry object types expose their specified Features.
- Line supports independent Begin Arrow Type and End Arrow Type.
- Thickness includes Very Thin, Thin, Normal, Medium, Thick, Very Thick, and Custom; Hairline is absent.
- Custom width validation works.
- Fill Colour appears when applicable for Solid fill.
- Polygon side-count changes update selected geometry.
- Arc and Polygon construction methods remain in the tool activation or toolbar controls, never in Features.
- Appearance changes never alter geometry.

### Transform
- Every supported transformable object across the application exposes applicable Transform controls.
- All nine specified Geometry objects expose X Shift, Y Shift, and Rotate.
- Every Transform field has an editable numeric input, an up arrow, and a down arrow.
- Each arrow applies exactly 0.1 drawing-space units or 0.1 degrees, as appropriate.
- Direct numeric entry applies a relative transformation.
- Transform inputs reset to zero when leaving and returning to the section, without undoing applied transformations.
- Multiple selected objects translate and rotate together where compatible.
- Fixed objects are not moved or rotated indirectly.

### Fixed, snapping, and persistence
- Fixed blocks ordinary movement, rotation, resizing, and reshaping for the specified Geometry objects.
- Fixed objects remain selectable, appearance-editable, unlockable, deletable, and snap-compatible.
- Fixed state survives saving and reopening.
- Grid Snap and Object Snap work independently.
- Disabling snapping does not alter existing geometry.

### Source and compatibility
- Source remains editable through the existing rendering pipeline.
- Geometry and supported non-Geometry properties remain synchronised with rendering and source.
- Selecting objects highlights the correct inventory rows, canvas geometry, and source regions.
- Existing specialised tools, engineering properties, calculations, and drawing behaviour are preserved.
- No new Geometry-only assumptions are imposed on the global Features panel.

## 12. Final design principle

DAETUM has **one universal Features tab for editing selected objects throughout the application**.

The Objects tab identifies and selects objects. The Features tab displays the properties relevant to the current selection, handles mixed values correctly, and provides applicable editing and Transform controls. The Source tab provides access to the actual editable drawing source.

Geometry is one supported category within this system, with the detailed settings defined above. Every other category continues to expose its own appropriate properties through the same universal panel architecture.

Keep the interface minimal, consistent, and predictable. Never display properties when nothing is selected, never misrepresent mixed values, and never modify unrelated objects or properties.