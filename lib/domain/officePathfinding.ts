import { NAV_GRAPH, type NavGraph, type NavNode } from "./officeLayout";

/**
 * Pure BFS over the office's waypoint graph — no Three.js import, unit-
 * testable under plain Vitest. The graph is a handful of nodes (doorways,
 * room fronts, workstations), so plain BFS is enough; there is no
 * arbitrary click-to-anywhere destination in this prototype (no founder
 * avatar yet — see the implementation plan), so a richer navmesh/
 * obstacle-raycast layer isn't needed on top of it.
 */

function buildAdjacency(graph: NavGraph): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const [a, b] of graph.edges) {
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }
  return adjacency;
}

/**
 * Shortest node-to-node path (by edge count) from `fromId` to `toId`,
 * returned as an ordered list of nodes including both endpoints. Returns
 * `null` if either id doesn't exist or no path connects them.
 */
export function findPath(fromId: string, toId: string, graph: NavGraph = NAV_GRAPH): NavNode[] | null {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!nodesById.has(fromId) || !nodesById.has(toId)) return null;
  if (fromId === toId) {
    const only = nodesById.get(fromId);
    return only ? [only] : null;
  }

  const adjacency = buildAdjacency(graph);
  const cameFrom = new Map<string, string>();
  const visited = new Set<string>([fromId]);
  const queue: string[] = [fromId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toId) break;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      cameFrom.set(next, current);
      queue.push(next);
    }
  }

  if (!visited.has(toId)) return null;

  const idPath: string[] = [toId];
  let cursor = toId;
  while (cursor !== fromId) {
    const prev = cameFrom.get(cursor);
    if (!prev) return null;
    idPath.push(prev);
    cursor = prev;
  }
  idPath.reverse();

  return idPath.map((id) => nodesById.get(id)!);
}

/** True if every node in the graph can reach every other node. */
export function isGraphFullyConnected(graph: NavGraph = NAV_GRAPH): boolean {
  if (graph.nodes.length === 0) return true;
  const adjacency = buildAdjacency(graph);
  const start = graph.nodes[0]!.id;
  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited.size === graph.nodes.length;
}
