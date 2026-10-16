/*
 * ============================================================
 * THE TABLE SIZE PICKER
 * ============================================================
 *
 * A Google-Docs-style grid: hover over cells to preview the number of rows and
 * columns, click to confirm. It is how a table's SHAPE is chosen before it is
 * placed, and it is deliberately the same gesture every word processor uses, so
 * there is nothing to learn.
 *
 * WHY A GRID AND NOT TWO NUMBER FIELDS.
 *
 * A table is chosen by its SHAPE - "about four by six" - and a grid shows that
 * shape directly: the cells under the cursor ARE the table. Two number boxes ask
 * the student to hold a two-dimensional size in their head while typing, and the
 * preview that follows is then the first time they see it. The grid makes the
 * choice and the preview the same act.
 *
 * The dimensions are CAPPED, and the cap is stated in the panel's own table
 * editor too, so a table cannot be made larger through one route than another.
 */
let openDialog = null;

const MAX_ROWS = 12;
const MAX_COLUMNS = 12;

function close() {
  if (openDialog) {
    openDialog.remove();
    openDialog = null;
  }
}

function isOpen() {
  return openDialog !== null;
}

function open(options = {}) {
  close();

  const dialog = document.createElement("div");

  dialog.className = "datum-table-picker";

  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Choose table size");

  const label = document.createElement("div");
  label.className = "datum-table-picker-label";
  label.textContent = "Choose table size";

  const grid = document.createElement("div");
  grid.className = "datum-table-picker-grid";

  const readout = document.createElement("div");
  readout.className = "datum-table-picker-readout";
  readout.textContent = "1 x 1";

  const cells = [];

  for (let row = 0; row < MAX_ROWS; row += 1) {
    for (let column = 0; column < MAX_COLUMNS; column += 1) {
      const cell = document.createElement("button");

      cell.type = "button";
      cell.className = "datum-table-picker-cell";
      cell.dataset.row = String(row + 1);
      cell.dataset.column = String(column + 1);
      cell.setAttribute("aria-label", `${row + 1} by ${column + 1}`);

      cells.push(cell);
      grid.appendChild(cell);
    }
  }

  /*
   * THE PREVIEW IS THE CELLS THEMSELVES. Moving over a cell highlights every
   * cell up to and including it - the rectangle the table would be - and prints
   * its size, so the hover IS the answer rather than a hint of one.
   */
  const highlight = (rows, columns) => {
    cells.forEach((cell) => {
      const inRange =
        Number(cell.dataset.row) <= rows &&
        Number(cell.dataset.column) <= columns;

      cell.classList.toggle("active", inRange);
    });

    readout.textContent = `${rows} x ${columns}`;
  };

  grid.addEventListener("pointerover", (event) => {
    const cell = event.target.closest("[data-row]");

    if (!cell) {
      return;
    }

    highlight(Number(cell.dataset.row), Number(cell.dataset.column));
  });

  grid.addEventListener("click", (event) => {
    const cell = event.target.closest("[data-row]");

    if (!cell) {
      return;
    }

    const rows = Number(cell.dataset.row);
    const columns = Number(cell.dataset.column);

    close();

    options.onPick?.({ rows, columns });
  });

  dialog.appendChild(label);
  dialog.appendChild(readout);
  dialog.appendChild(grid);

  document.body.appendChild(dialog);

  openDialog = dialog;

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();

      close();
      options.onCancel?.();
    }
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      close();
      options.onCancel?.();
    }
  });

  highlight(1, 1);

  return dialog;
}

const enggTablePicker = {
  MAX_COLUMNS,
  MAX_ROWS,
  close,
  isOpen,
  open,
};

export default enggTablePicker;
