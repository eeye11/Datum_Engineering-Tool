/*
 * ============================================================
 * THE FEATURES PANE
 * ============================================================
 *
 * The Features tab shows the SELECTION's own editable properties across every
 * tool category, and is empty when nothing is selected. The implementation
 * lives in `features-editor.js`; this module is the stable entry point the rest
 * of the application imports, and it keeps the names callers already use.
 *
 * THE PER-TOOL DEFAULTS ARE NOT THIS PANE. An armed tool's construction and
 * appearance defaults describe the next object it will make, not the one the
 * student has selected, so they are not shown here - activating a tool does not
 * count as selecting an object. The store those defaults live in is
 * `tool-settings-store.js`, and creation reads it from there.
 */

import { installFeaturesPane, renderFeatures } from "./features-editor.js";
import {
  defaultFixedFor,
  toolAppearance,
  toolSetting,
} from "./tool-settings-store.js";

export {
  featuresMarkupForSelection,
  installFeaturesPane,
  renderFeatures,
  selectedObjects,
} from "./features-editor.js";

export {
  defaultFixedFor,
  toolAppearance,
  toolSetting,
} from "./tool-settings-store.js";

export default {
  renderFeatures,
  installFeaturesPane,
  toolSetting,
  toolAppearance,
  defaultFixedFor,
};
