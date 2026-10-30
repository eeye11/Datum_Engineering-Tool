# Dimension

Use **Annotate → Dimensions → Dimension**:

1. Click the first endpoint.
2. Click the second endpoint.
3. Move the arrow away from the geometry and click to place it.
4. Enter the magnitude, including units if needed (for example `65 mm` or `L/2`).

Endpoints snap to nearby corners, midpoints, and positions along straight
edges using a screen-sized tolerance. Picking near both ends of a rectangle
snaps to its full span; picking an internal line produces a partial span.
Empty canvas points are also allowed. Two edge picks do not imply an angle.
Horizontal and vertical spans align automatically; other spans are aligned
with their picked endpoints. Blank magnitude entries are refused; Escape
cancels without creating a dimension.

After placement, the tool returns to **Select**. Double-click a dimension or
edit **Magnitude** in Features to change its text. The entered magnitude is an
annotation and does not resize geometry. Snapped endpoints follow referenced
features, including fractional positions along an edge. Drag the annotation
to adjust its placement.

Magnitude, placement, and endpoints are preserved in saved `.tex` document data
and undo/redo. Existing Smart and Variable dimensions can still be loaded;
editing their magnitude converts them to the unified annotation.

## Angle

Choose **Annotate → Dimensions → Angle**, click two straight lines or shape
edges, then move into the angle region you want and click to place the marker.
The label opens with the measured angle, including degrees; accept it or type
custom text such as `θ`. Double-click the annotation or use its Magnitude field
to edit the label. Completion returns to Select.

Angles retain both geometry references. Lines, rectangle/rigid-body edges,
triangle edges, polyline segments, and polygon edges are supported. The vertex
is the intersection of the supporting lines, even when it lies beyond the drawn
segments. Placement chooses the acute or obtuse region. Perpendicular geometry
draws a square corner; near-right angles retain an arc. Parallel or degenerate
lines are refused. Marker geometry follows later reference edits; authored label
text is preserved, as with Dimension. Canvas and TeX export share the same marker.

Labels sit outside their measurement line or angle marker, with clearance that
accounts for text size and zoom. Both preview and TeX export use the same label
position.

Select a Dimension or Angle and use **Features → Dimension → Text size (px)**
to change its label size (6–64 px). Label clearance adjusts with the text size.

Annotation text editors and editable text fields in Features offer **Ω Insert
symbol**. Search or browse the symbol library to insert a glyph at the caret,
or replace the selected text. This works for notes, labels, callouts, and
Dimension/Angle magnitudes; symbols remain part of the editable text.

Select a Callout and use **Features → Text → Balloon shape** to switch between
Rectangle and Circle. The balloon grows to contain its text; the shape is saved
with the drawing and used in TeX export.
