import enggPipeDuct from "./pipe-duct.js";
const CONTINUATION_TOLERANCE = 1e-6;

export function propagatePipeWidth(run, objects = []) {
  if (!run?.id || !Array.isArray(objects)) {
    return [];
  }

  const runs = objects.filter((object) => enggPipeDuct.isPipeDuctType(object.type));
  const elbows = objects.filter(object => ["elbow", "junction", "reducer-expander", "pump", "valve", "flow-meter"].includes(object.type));

  /* An end that carries a fitting stops the walk there. */
  const joinedAt = (candidate, end) =>
    elbows.some((elbow) => {
      const ids = elbow.type === "junction" ? (elbow.geometry?.branches || []).map(branch => branch.connected) : elbow.engineering?.connections || elbow.engineering?.pipeIds || [];

      if (!ids.includes(candidate.id)) {
        return false;
      }

      if (elbow.type === "reducer-expander") {
          return (elbow.engineering.startPipeId === candidate.id && elbow.engineering.ports?.start === end) ||
              (elbow.engineering.endPipeId === candidate.id && elbow.engineering.ports?.end === end);
      }
      if (elbow.type === "junction") return (elbow.geometry?.branches || []).some(branch => branch.connected === candidate.id && (!branch.connectedPort || branch.connectedPort === end));
      const shared = elbow.geometry?.position;
      const point = candidate.geometry?.[end];

      return (
        shared &&
        point &&
        Math.hypot(shared.x - point.x, shared.y - point.y) <= CONTINUATION_TOLERANCE
      );
    });

  const visited = new Set([run.id]);
  const queue = [run];

  /*
   * THE WIDTH IS READ WHEN THE RUN IS REACHED, not from the run the walk began
   * at. The walk may start from either side of a join, and the side the student
   * widened is the one whose value must spread.
   */
  const widthOf = (candidate) =>
    (Number(candidate.engineering?.schematicWidth) || enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION) - enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION;

  while (queue.length) {
    const current = queue.pop();

    ["start", "end"].forEach((end) => {
      if (joinedAt(current, end)) {
        return;
      }

      const point = current.geometry?.[end];

      if (!point) {
        return;
      }

      const neighbours = runs.filter(candidate => candidate.id !== current.id && ["start","end"].some(candidateEnd =>
          candidate.geometry?.[candidateEnd] && Math.hypot(candidate.geometry[candidateEnd].x-point.x,candidate.geometry[candidateEnd].y-point.y) <= CONTINUATION_TOLERANCE));
      if (neighbours.length !== 1) return;
      neighbours.forEach((candidate) => {
        if (visited.has(candidate.id)) {
          return;
        }

        const other = ["start", "end"].find(
          (candidateEnd) =>
            candidate.geometry?.[candidateEnd] &&
            Math.hypot(
              candidate.geometry[candidateEnd].x - point.x,
              candidate.geometry[candidateEnd].y - point.y
            ) <= CONTINUATION_TOLERANCE
        );

        if (!other || joinedAt(candidate, other) || candidate.locked) {
          return;
        }

        visited.add(candidate.id);
        queue.push(candidate);

        const source = widthOf(current);

        if ((Number(candidate.engineering?.schematicWidth) || enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION) !==
            (Number(current.engineering?.schematicWidth) || enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION)) {
          candidate.engineering = { ...(candidate.engineering || {}) };
          candidate.engineering.schematicWidth = current.engineering?.schematicWidth ?? enggPipeDuct.DEFAULT_SCHEMATIC_SEPARATION;
        }
      });
    });
  }

  return [...visited].filter((id) => id !== run.id);
}

