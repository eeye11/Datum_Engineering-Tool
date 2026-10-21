# DAETUM object comments — schema and rules

Every drawing object DAETUM generates into a drawing source is preceded by a
readable comment header. The header names the object, carries its **stable ID**,
and records the relationships a composite object needs. It is ordinary LaTeX
comment text, so it never changes the picture, and a `.tex` carrying it still
compiles in any LaTeX installation.

The implementation lives in
`src/shared/rendering/latex/object-comments.js`; the block format is written and
read by `src/shared/rendering/latex/drawing-source.js`.

---

## 1. Format

```latex
% DAETUM OBJECT: Point Force 1
% DAETUM ID: force-1a2b3c4d
% DAETUM TYPE: force
\draw[draw=black, line width=0.4927pt,
      -{Latex[length=2.956pt, width=1.774pt]}]
      (0,71.1398) -- (126.259,6.4705);

% DAETUM OBJECT: Force Magnitude Label
% DAETUM ID: force-1a2b3c4d:label
% DAETUM PART: label
% DAETUM PARENT: force-1a2b3c4d
\node[anchor=west, text=black,
      font=\fontsize{6}{7.2}\selectfont]
      at (127.3554,5.909) {$F = 345.5\,\mathrm{N}$};
```

| Marker | Meaning | Required |
|---|---|---|
| `% DAETUM OBJECT: <name>` | Opens a block. A readable name for the object. | yes |
| `% DAETUM ID: <id>` | The object's stable identity. | yes, for an object |
| `% DAETUM TYPE: <type>` | The internal feature type (`force`, `beam`, `dimension`, …). | yes |
| `% DAETUM PART: <role>` | Names a component's role within its logical object. | components |
| `% DAETUM PARENT: <id>` | The id of the logical object a component belongs to. | components |
| `% DAETUM END: <id>` | Optional explicit block terminator. | no |

Rules:

- Every metadata line **begins** with `% DAETUM`. A comment that merely mentions
  DAETUM — a student's `% which is 40% of the force` — is never metadata.
- A header runs until the first line that is not another marker line. The block's
  commands follow immediately; a block ends at the next header, at
  `\end{tikzpicture}`, or at the end of the text.
- No metadata line may appear inside a multi-line command, where a `%` comment
  would end that line of the command. Headers are always written at block level.
- Values are single-line: a line break in a name is collapsed to a space.

### Legacy markers

A source saved by an older build may carry:

```latex
% DAETUM_OBJECT_BEGIN id="line-1" type="line"
...
% DAETUM_OBJECT_END id="line-1"
```

The parser still reads these, so an older file keeps every object. The next time
an object's source is written it is rewritten in the readable form.

---

## 2. Stable IDs

An ID is minted when an object is created (`drawing-state.js`) and kept for the
object's whole life. It does **not** change when the student:

- moves, resizes or restyles the object;
- changes its features or its display label;
- edits supported source properties;
- saves and reopens the document;
- switches sheets or workspaces;
- regenerates the object's LaTeX.

`ensureObjectId(object)` (in `object-comments.js`) only assigns an id when the
object has none — a test fixture or an imported object — so repeated generation
can never mint a new identity.

### Components

A logical object may be several primitives. A force is an arrow, a label and a
magnitude; a dimension is witnesses, a line, an arc and its text. Those are **one
object** to the student and stay one editable object; the component metadata
records the relationship without creating a second object.

Component IDs are derived from the parent and the role:
`<parent-id>:<role>` (e.g. `force-1a2b3c4d:label`). They are stable for as long
as the parent is, and `isPartId()` / `parentIdOf()` distinguish them from a
top-level object.
---

## 3. Identity vs. visible labels

Three things are kept strictly apart:

| | Example | Where it appears |
|---|---|---|
| **Internal type** | `force` | object model, `% DAETUM TYPE:` comment |
| **Object name** | `Point Force 1` | Objects list, `% DAETUM OBJECT:` comment |
| **Visible content** | `F = 345.5 N`, a typed label | the drawing |

A tool name is never a label. The writers emit a text node only for:

1. the student's own `label` (Features → Text → Label), or
2. the object's name when `showName` is explicitly on (Features → Text → Show
   Name), or
3. content the tool's documented behaviour requires (a value annotation such as
   `$F = 345.5\,\mathrm{N}$`, a dimension's measured value, a diagram's axes).

---

## 4. Reading a source back

`parseDrawingSource(source)` returns, per block:
`{ id, type, name, part, parent, beginLine, headerEndLine, endLine, bodyStartLine,
bodyEndLine, legacy, unclosed, lines }`.

`createSourceMap(source)` adds id→block and line→id lookups, so:

- selecting an object finds its source region;
- selecting source inside a block finds the object;
- updating one object rewrites only its region.

Parsing is tolerant by design. A missing header, a duplicated id, a malformed
marker or a pasted document without DAETUM comments is reported, never silently
bound: a duplicated id is flagged by `source-validation.js`, and content whose
identity is unknown is preserved and rendered as ordinary source.

---

## 5. Where the comments live

Comments belong to the **drawing source**: the Engineering Drawing Source panel
and the drawing fragments of an export. The Written Solution keeps its protected
drawing inclusion (`\input{drawings/drawing_001.tex}` or an embedded picture);
its object-level comments live in the referenced drawing, not in the written
solution's document structure.

The Source panel shows the comments, because they are the drawing's code. Each
header is rendered with the editor's muted `ds-marker` style; the picture that is
compiled, and the picture inserted into the written solution, are the same
commands with the metadata lines removed (`visibleDrawingSource`).

---

## 6. Limitations

### Component headers are not emitted inside a logical object

The format supports `% DAETUM PART:` and `% DAETUM PARENT:`, and
`renderObjectBlock({ id, type, name, part, parent, source })` writes them. The
**Statics writer does not emit them**, and this is deliberate.

`parseDrawingSource` ends a block at the next header. A component header placed
between a force's arrow and its magnitude label therefore **splits** the object
into two regions: the parent's block loses its text, a targeted update based on
`objectRegion(source, parentId)` rewrites only one half of the object, and the
source map reports two blocks for one feature. That is a worse failure than the
missing relationship it was meant to record — one undoable object must stay one
contiguous region.

So today the relationship is carried by the **id scheme** rather than by
repeated headers:

- one logical object → one block, under its own id;
- its text primitives live inside that block and move with it;
- `partId(parent, role)` and `parentIdOf(id)` are ready for a caller that really
  does keep separate source components.

Recording PART/PARENT without splitting the region needs a change to the parser
(a closing marker, or indented child headers the parser ignores as boundaries).
That is an open item, not something the current writers pretend to do.
