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
