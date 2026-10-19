/*
 * ============================================================
 * THE TOOL-LIBRARY REGISTRY LOADER
 * ============================================================
 *
 * The tool library is described by one JSON manifest:
 * src/tool-library/registry/tool-registry.json. This module loads it and
 * exposes small, read-only queries over the hierarchy:
 *
 *   categories()              every top-level category, in display order
 *   groupsFor(categoryId)    the groups inside one category
 *   tool(id)                  one tool entry, or null
 *   childrenOf(parentId)      the tools whose parentId names the given id
 *   libraryPathFor(toolId)    the folder a tool's implementation lives in
 *
 * PHASE 2 SCOPE. The registry describes what exists in the library and how
 * the tools are organised; it does not load, execute or render any LaTeX
 * tool code. The interface does not read from it yet - the toolbar keeps
 * its existing definition - so this module is infrastructure for the next
 * phase, imported by nothing but available to anything.
 */

import registryData from "../../tool-library/registry/tool-registry.json" with { type: "json" };

/* The imported JSON module reads as a plain object; keep the original name below. */
const registryJson = registryData;

const byId = new Map();

(function index(node) {
    if (node?.kind === "tool" && node.id && !byId.has(node.id)) {
        byId.set(node.id, node);
    }

    (node?.categories || []).forEach(index);
    (node?.groups || []).forEach(index);
    (node?.subgroups || []).forEach(index);
    (node?.tools || []).forEach(index);
})(registryJson);

export function categories() {
    return registryJson.categories;
}

export function groupsFor(categoryId) {
    return (
        registryJson.categories.find(
            (category) => category.id === categoryId
        )?.groups || []
    );
}

export function tool(id) {
    return byId.get(id) || null;
}

export function childrenOf(parentId) {
    const found = [];

    (function walk(node) {
        (node?.tools || []).forEach((entry) => {
            if (entry.parentId === parentId) {
                found.push(entry);
            }
        });

        (node?.categories || []).forEach(walk);
        (node?.groups || []).forEach(walk);
        (node?.subgroups || []).forEach(walk);
    })(registryJson);

    return found;
}

export function libraryPathFor(toolId) {
    return byId.get(toolId)?.libraryPath || null;
}

/*
 * Every tool entry, in the registry's own order. The implementation loader and
 * the consistency check both need to walk the whole hierarchy, and doing that
 * in one place keeps the traversal from being written three times.
 */
export function allTools() {
    const found = [];

    (function walk(node) {
        (node?.tools || []).forEach((entry) => {
            if (entry?.kind === "tool" && entry.id) {
                found.push(entry);
            }
        });

        (node?.categories || []).forEach(walk);
        (node?.groups || []).forEach(walk);
        (node?.subgroups || []).forEach(walk);
    })(registryJson);

    return found;
}

const enggToolRegistry = {
    registry: registryJson,
    categories,
    groupsFor,
    tool,
    childrenOf,
    allTools,
    libraryPathFor
};

export default enggToolRegistry;
