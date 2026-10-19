# DAETUM Tool Library

The organised library of individual drawing-tool implementations.

The **nine Geometry tools** (Point, Line, Triangle, Rectangle, Circle, Arc,
Polygon, Freeform Polygon, Coordinate System) are implemented: each has a
manifest, a Features declaration, a TikZ construction template, and a source
generator in `src/shared/rendering/latex/source-writers/`. Other categories
still carry the structure and are filled in as their tools land.

## Layout

- `registry/tool-registry.json` — the authoritative parent–child tool
  hierarchy: categories, groups, parent groups (e.g. Statics → Bodies and
  its children), and individually selectable tools, each pointing at its
  library folder.
- `<category>/<group>/<tool>/` — one folder per tool, containing:
  - `manifest.json` — tool identity, metadata, parent relationship.
  - `template.tex` — the TikZ construction the tool emits, with the
    substitution points stated. A template is NOT static output: the
    generator receives the committed geometry and feature settings.
  - `features.json` — the Features panel settings, when the tool has any.
- `shared/primitives/tikz-primitives.js` — the reusable TikZ primitives
  (paths, shapes, markers, nodes, arrows, thickness presets, colour
  handling) every template and source writer composes. Do not duplicate a
  line, curve, anchor or text-node pattern inside a tool folder.

## Conventions

- Tool folders are named after the tool id, in kebab-case.
- `manifest.json` is the single record of a tool's identity and location;
  the registry points at the folder, the manifest describes the tool.
- `registry/` stays metadata only. No LaTeX and no panel configuration
  lives there, so the hierarchy can be read without loading a tool.
- Appearance settings use the shared vocabulary: named thickness presets
  (`very-thin`, `thin`, `normal`, `medium`, `thick`, `very-thick`), line
  types (`solid`, `dashed`, `dotted`), fill modes (`none`, `solid`) and
  arrow ends (`none`, `open`, `filled`, `bar`). No physical units.
- Do not add placeholder files for hypothetical future features.
