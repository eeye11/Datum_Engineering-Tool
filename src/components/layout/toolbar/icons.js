/*
 * ============================================================
 * THE ICON SET
 * ============================================================
 *
 * One outline icon set for the whole interface - the menu commands, the
 * dropdown items, the quick-access toolbar and the settings pages. Every icon
 * here is drawn in the same language as the tool icons the application already
 * ships (`editor/tools.js`): a 20x20 viewBox, no fill, a single stroke, round
 * caps and joins.
 *
 * WHY IT IS WRITTEN AS SVG PATH DATA RATHER THAN A LIBRARY
 * -------------------------------------------------------
 * The application already draws its own tool icons this way, and adding an icon
 * library for the menus would put two visual languages side by side - the tool
 * palette drawn one way and the menus another, which is precisely the
 * inconsistency this work exists to remove. It also keeps the interface working
 * offline, with no font to load and nothing to fail.
 *
 * WHAT EACH ICON MUST DO
 * ----------------------
 * Help the reader understand the command. A "Printer" for Print, a "Scissors"
 * for Cut, a grid for the grid. An icon that is merely decorative, or that
 * looks like three other icons, makes the menu harder to read rather than
 * easier - so where a command's meaning is not obvious the LABEL carries it and
 * the icon simply agrees with it.
 *
 * THE STROKE WEIGHT IS ONE NUMBER. `stroke-width="1.4"` on every icon, so no
 * icon looks heavier than its neighbour - the fault that makes a hand-drawn set
 * look assembled rather than designed.
 */

const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';

/*
 * One icon, at the size a menu row uses.
 *
 * `currentColor` is deliberate: the icon takes its colour from the text beside
 * it, so it follows the theme, the hover state, the disabled state and the
 * accent automatically - there is no second place colour is decided.
 */
export function menuIcon(name, size = 16) {
  const path = ICONS[name];

  if (!path) {
    /*
     * AN UNKNOWN NAME IS NOT AN ERROR - it is a menu item that has not been
     * given an icon yet, and it renders as a fixed-width empty slot so the
     * labels below it stay aligned. A missing icon must not shift a column.
     */
    return `<svg class="datum-icon" viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true"></svg>`;
  }

  return `<svg class="datum-icon" viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true">${path}</svg>`;
}

export function hasIcon(name) {
  return Boolean(ICONS[name]);
}

/*
 * THE ICONS.
 *
 * Grouped by the menu they serve, so a reader looking for "the Print icon"
 * finds it beside the other File icons rather than in one long alphabetical
 * list. Several are shared - a grid is a grid - because two icons for one idea
 * is the drift this set exists to prevent.
 */
const ICONS = {
  /* ---------------------------------------------------- File */
  "file-plus": `<path ${STROKE} d="M4 3h7l4 4v10H4z"/><path ${STROKE} d="M11 3v4h4"/><path ${STROKE} d="M7.5 11.5h4M9.5 9.5v4"/>`,
  "folder-open": `<path ${STROKE} d="M3 6h4l1.5 2H17l-2 7H3z"/><path ${STROKE} d="M3 6V4h4l1.5 2"/>`,
  save: `<path ${STROKE} d="M4 3h9l3 3v11H4z"/><path ${STROKE} d="M7 3v5h6V3"/><path ${STROKE} d="M7 17v-5h6v5"/>`,
  "file-pen": `<path ${STROKE} d="M4 3h6l3 3v5"/><path ${STROKE} d="M4 3v14h5"/><path ${STROKE} d="M12 17l1-3 4-4 2 2-4 4z"/>`,
  printer: `<path ${STROKE} d="M6 7V3h8v4"/><path ${STROKE} d="M4 7h12v6h-2"/><path ${STROKE} d="M6 13H4V7"/><path ${STROKE} d="M6 11h8v6H6z"/>`,

  /*
   * DOWNLOAD: an arrow into a tray - "take this out of the application". The
   * same shape every browser and file manager uses for a download, so it needs
   * no learning, and the tray is what distinguishes it from a plain arrow.
   */
  download: `<path ${STROKE} d="M10 3v9"/><path ${STROKE} d="M6.5 8.5L10 12l3.5-3.5"/><path ${STROKE} d="M4 14v3h12v-3"/>`,

  /* A PDF's own mark: a page with folded corner and a text rule. */
  "file-text": `<path ${STROKE} d="M5 3h6l4 4v10H5z"/><path ${STROKE} d="M11 3v4h4"/><path ${STROKE} d="M8 11h4M8 13.5h4"/>`,

  /*
   * THE SUBMENU CHEVRON. A right-pointing caret that means "open me for more".
   * It is used ONLY on a menu row that has children - the six top-level menu
   * labels stay plain, because they are already a nested level.
   */
  "chevron-right": `<path ${STROKE} d="M8 5l5 5-5 5"/>`,

  /* ---------------------------------------------------- Edit */
  "undo-2": `<path ${STROKE} d="M7 6L3 10l4 4"/><path ${STROKE} d="M4 10h7a4 4 0 0 1 4 4v1"/>`,
  "redo-2": `<path ${STROKE} d="M13 6l4 4-4 4"/><path ${STROKE} d="M16 10H9a4 4 0 0 0-4 4v1"/>`,
  scissors: `<circle ${STROKE} cx="5.5" cy="15" r="2"/><circle ${STROKE} cx="5.5" cy="5" r="2"/><path ${STROKE} d="M7.2 6.4L16 15M7.2 13.6L16 5"/>`,
  copy: `<rect ${STROKE} x="7" y="7" width="10" height="10" rx="1"/><path ${STROKE} d="M13 7V4H3v10h3"/>`,
  "clipboard-paste": `<path ${STROKE} d="M7 4H5v13h10V4h-2"/><rect ${STROKE} x="8" y="2.5" width="4" height="3" rx="1"/><path ${STROKE} d="M7 10h6M7 13h4"/>`,
  selection: `<path ${STROKE} stroke-dasharray="2.5 2" d="M4 4h12v12H4z"/>`,
  "trash-2": `<path ${STROKE} d="M4 6h12"/><path ${STROKE} d="M8 6V4h4v2"/><path ${STROKE} d="M6 6l1 11h6l1-11"/><path ${STROKE} d="M9 9v5M11 9v5"/>`,

  /* PENCIL: a nib over a rule - the conventional "rename / edit the name" mark. */
  pencil: `<path ${STROKE} d="M13.5 4.5l2 2L7 15l-2.5.5.5-2.5z"/><path ${STROKE} d="M12 6l2 2"/>`,

  /*
   * SHARE: three nodes joined by two links - the standard share mark, and the
   * one that says "pass this on" rather than "upload" or "send".
   */
  "share-2": `<circle ${STROKE} cx="14" cy="5.5" r="2"/><circle ${STROKE} cx="6" cy="10" r="2"/><circle ${STROKE} cx="14" cy="14.5" r="2"/><path ${STROKE} d="M7.8 9l4.4-2.5M7.8 11l4.4 2.5"/>`,

  /* ---------------------------------------------------- Insert */
  image: `<rect ${STROKE} x="3" y="4" width="14" height="12" rx="1"/><circle ${STROKE} cx="7" cy="8" r="1.3"/><path ${STROKE} d="M4 14l4-4 3 3 2-2 3 3"/>`,
  table: `<rect ${STROKE} x="3" y="4" width="14" height="12" rx="1"/><path ${STROKE} d="M3 8h14M3 12h14M8 4v12M13 4v12"/>`,
  "text-cursor": `<path ${STROKE} d="M10 4v12"/><path ${STROKE} d="M7 4h6M7 16h6"/><path ${STROKE} d="M4 8h2M4 12h2M14 8h2M14 12h2"/>`,
  shapes: `<path ${STROKE} d="M3 8h6v6H3z"/><circle ${STROKE} cx="14.5" cy="12.5" r="3.5"/>`,

  /* ---------------------------------------------------- View */
  hand: `<path ${STROKE} d="M6.5 10V6a1 1 0 0 1 2 0v3.2V4.6a1 1 0 0 1 2 0v4.6V5.4a1 1 0 0 1 2 0v4.2V7a1 1 0 0 1 2 0v6c0 2.6-1.8 4-4.2 4-2 0-3-.8-3.8-2.2l-1.4-2.6a1 1 0 0 1 1.6-1.2z"/>`,
  "zoom-in": `<circle ${STROKE} cx="9" cy="9" r="5"/><path ${STROKE} d="M12.8 12.8L17 17M9 6.5v5M6.5 9h5"/>`,
  "zoom-out": `<circle ${STROKE} cx="9" cy="9" r="5"/><path ${STROKE} d="M12.8 12.8L17 17M6.5 9h5"/>`,
  "maximize-2": `<path ${STROKE} d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4"/>`,
  grid: `<rect ${STROKE} x="3" y="3" width="14" height="14" rx="1"/><path ${STROKE} d="M3 7.7h14M3 12.3h14M7.7 3v14M12.3 3v14"/>`,
  ruler: `<path ${STROKE} d="M3 12.5L12.5 3l4.5 4.5L7.5 17z"/><path ${STROKE} d="M7 8.5l1.5 1.5M9.5 6l1.5 1.5M12 3.5L13.5 5"/>`,
  "arrow-up-right": `<path ${STROKE} d="M6 14L14 6"/><path ${STROKE} d="M9 6h5v5"/>`,

  /* ---------------------------------------------------- Tools */
  "settings-2": `<path ${STROKE} d="M4 7h12M4 13h12"/><circle ${STROKE} cx="8" cy="7" r="1.8"/><circle ${STROKE} cx="13" cy="13" r="1.8"/>`,
  crosshair: `<circle ${STROKE} cx="10" cy="10" r="5"/><path ${STROKE} d="M10 2v3M10 15v3M2 10h3M15 10h3"/>`,
  keyboard: `<rect ${STROKE} x="2.5" y="5.5" width="15" height="9" rx="1.5"/><path ${STROKE} d="M5 8.5h1M8 8.5h1M11 8.5h1M14 8.5h1M5 11.5h10"/>`,
  palette: `<path ${STROKE} d="M10 3a7 7 0 0 0 0 14c1.1 0 1.6-.8 1.6-1.5 0-1.4-1.2-1.6-1.2-2.6 0-.7.6-1.2 1.4-1.2H13a4 4 0 0 0 4-4c0-2.6-3.1-4.7-7-4.7z"/><circle ${STROKE} cx="7" cy="8" r="0.9"/><circle ${STROKE} cx="9.5" cy="6" r="0.9"/><circle ${STROKE} cx="12.5" cy="7" r="0.9"/>`,
  eye: `<path ${STROKE} d="M2.5 10S5.5 5 10 5s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z"/><circle ${STROKE} cx="10" cy="10" r="2"/>`,
  "document-settings": `<path ${STROKE} d="M4 3h7l4 4v4"/><path ${STROKE} d="M11 3v4h4"/><path ${STROKE} d="M4 3v14h5"/><circle ${STROKE} cx="14" cy="14" r="2"/><path ${STROKE} d="M14 11v1M14 16v1M11 14h1M16 14h1"/>`,
  "sun-moon": `<circle ${STROKE} cx="10" cy="10" r="3.2"/><path ${STROKE} d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4"/>`,
  "scan-search": `<path ${STROKE} d="M4 6.5V4h2.5M13.5 4H16v2.5M16 13.5V16h-2.5M6.5 16H4v-2.5"/><circle ${STROKE} cx="10" cy="10" r="3"/><path ${STROKE} d="M12.2 12.2l2 2"/>`,

  /* ---------------------------------------------------- Help */
  "book-open": `<path ${STROKE} d="M10 5.5C8.5 4.5 6.5 4 3.5 4v10c3 0 5 .5 6.5 1.5 1.5-1 3.5-1.5 6.5-1.5V4c-3 0-5 .5-6.5 1.5z"/><path ${STROKE} d="M10 5.5v10"/>`,
  "drafting-compass": `<path ${STROKE} d="M10 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/><path ${STROKE} d="M10 4.5L5.5 14M10 4.5l4.5 9.5"/><path ${STROKE} d="M4.5 15.5h11"/>`,
  "message-square": `<path ${STROKE} d="M3.5 5.5h13v8h-8l-3 3v-3h-2z"/>`,
  "message-square-warning": `<path ${STROKE} d="M3.5 5.5h13v8h-8l-3 3v-3h-2z"/><path ${STROKE} d="M10 7v3.2M10 11.8v.4"/>`,
  info: `<circle ${STROKE} cx="10" cy="10" r="7"/><path ${STROKE} d="M10 9v4.5M10 6.4v.4"/>`,

  /* ------------------------------------------- Snap targets */
  "snap-endpoint": `<path ${STROKE} d="M3 16L16 4"/><circle ${STROKE} cx="16" cy="4" r="1.8"/>`,
  "snap-midpoint": `<path ${STROKE} d="M3 10h14"/><circle ${STROKE} cx="10" cy="10" r="1.8"/>`,
  "snap-intersection": `<path ${STROKE} d="M4 4l12 12M16 4L4 16"/><circle ${STROKE} cx="10" cy="10" r="1.8"/>`,
  "snap-center": `<circle ${STROKE} cx="10" cy="10" r="6"/><circle ${STROKE} cx="10" cy="10" r="1.3"/>`,
  "snap-quadrant": `<circle ${STROKE} cx="10" cy="10" r="6"/><path ${STROKE} d="M10 4v12M4 10h12"/>`,
  "snap-point": `<path ${STROKE} d="M3 14h14"/><circle ${STROKE} cx="9" cy="14" r="1.8"/>`,
  "snap-inference": `<path ${STROKE} d="M3 7h14M3 13h14"/><path ${STROKE} stroke-dasharray="2 2" d="M6 7v6M14 7v6"/>`,

  /* ------------------------------------------------ Measuring */
  protractor: `<path ${STROKE} d="M3.5 14a6.5 6.5 0 0 1 13 0z"/><path ${STROKE} d="M10 14V8"/><path ${STROKE} d="M6 14l2-4M14 14l-2-4"/>`,
};

const enggIcons = {
  hasIcon,
  menuIcon,
  ICONS,
};

export default enggIcons;
