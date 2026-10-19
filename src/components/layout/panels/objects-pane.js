/*
 * ============================================================
 * THE OBJECTS PANE
 * ============================================================
 *
 * Renders the Objects tab: the inventory of the active sheet's objects, each
 * row a type icon and a name, with the shared selection highlighted. The
 * implementation lives in `objects-list.js`; this module is the entry point the
 * rest of the application imports, so the existing call sites keep working.
 *
 * The Objects tab identifies and selects. It never edits - every property of the
 * selection belongs to Features.
 */

import { installObjectsPane, renderObjects } from "./objects-list.js";

export {
  installObjectsPane,
  objectsListMarkup,
  renderObjects,
} from "./objects-list.js";

export default {
  renderObjects,
  installObjectsPane,
};
