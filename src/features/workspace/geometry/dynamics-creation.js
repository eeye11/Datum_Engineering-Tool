/*
 * Creating a Dynamics feature from a completed gesture.
 *
 * ONE ENTRY POINT for every Dynamics tool, the analogue of the Statics
 * `createStaticsFeature`: the tool id and the points the gesture produced go
 * in, one committed, selected, undoable feature comes out. Both the direct
 * call (the click-placed tools, and the tests that exercise the pipeline
 * headlessly) and the two-click span gesture in `geometry-creation.js` come
 * through here, so there is exactly one implementation of "place a spring".
 */

import { commitCreatedFeature } from "./creation-commit.js";
import { renderProperties } from "../../../components/layout/panels/feature-panel.js";
import { setToolMessage } from "../../../components/layout/toolbar/toolbar-render.js";
import {
    DYNAMICS_PLACEMENT_TOOLS,
    dynamicsObjectName,
    dynamicsInstruction,
    isDynamicsTool,
    resolveDynamicsToolId
} from "../dynamics/dynamics-tools.js";
import { createDynamicsObject } from "../dynamics/dynamics-model.js";

/*
 * Build the Dynamics object, add it as one undoable action, select it and
 * hand the panel and the sheet the news. `points` is whatever the gesture
 * produced - one point for a placement tool, two for a span, box or angle
 * tool; the model's builders take what they need and ignore the rest.
 *
 * Returns the stored object, or null when the tool is not a Dynamics tool or
 * its builder refused the points (a zero-length chord, say) - the caller
 * reports that rather than committing an empty object.
 */
export function createDynamicsFeature(
    toolId,
    first,
    second,
    style = {}
) {
    const resolved = resolveDynamicsToolId(toolId);

    if (!resolved || !isDynamicsTool(resolved)) {
        return null;
    }

    const points = [first, second].filter(Boolean);

    const object = createDynamicsObject(
        resolved,
        points,
        style
    );

    if (!object) {
        setToolMessage("That tool could not be created");

        return null;
    }

    commitCreatedFeature(object);

    setToolMessage(
        DYNAMICS_PLACEMENT_TOOLS[resolved]
            ? `Click to place the next ${dynamicsObjectName(resolved).toLowerCase()}`
            : dynamicsInstruction(resolved)
    );

    renderProperties();

    return object;
}
