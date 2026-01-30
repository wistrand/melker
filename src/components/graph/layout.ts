/**
 * Graph Layout Engine
 *
 * Calculates node positions for rendering.
 * Uses a simple layered layout algorithm:
 * 1. Assign levels using longest path from roots
 * 2. Order nodes within levels to reduce crossings
 */

import type { GraphDefinition, GraphLayout, NodePlacement, GraphDirection } from './types.ts';

/**
 * Calculate layout for a graph
 */
export function calculateLayout(graph: GraphDefinition): GraphLayout {
  const { nodes, edges, direction } = graph;

  if (nodes.length === 0) {
    return {
      direction,
      placements: [],
      maxLevel: 0,
      maxPositions: 0,
    };
  }

  // Build adjacency lists
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  }

  // Find root nodes (no incoming edges)
  const roots = nodes.filter(n => incoming.get(n.id)?.length === 0).map(n => n.id);

  // If no roots found (cycle), use all nodes as potential roots
  const startNodes = roots.length > 0 ? roots : nodes.map(n => n.id);

  // Assign levels using BFS from roots
  const levels = assignLevels(startNodes, outgoing, nodes.map(n => n.id));

  // Group nodes by level
  const levelGroups = new Map<number, string[]>();
  let maxLevel = 0;

  for (const [nodeId, level] of levels) {
    if (!levelGroups.has(level)) {
      levelGroups.set(level, []);
    }
    levelGroups.get(level)!.push(nodeId);
    maxLevel = Math.max(maxLevel, level);
  }

  // Order nodes within each level to reduce crossings
  orderNodesInLevels(levelGroups, edges, maxLevel);

  // Build placements
  const placements: NodePlacement[] = [];
  let maxPositions = 0;

  for (let level = 0; level <= maxLevel; level++) {
    const nodesAtLevel = levelGroups.get(level) || [];
    maxPositions = Math.max(maxPositions, nodesAtLevel.length);

    for (let pos = 0; pos < nodesAtLevel.length; pos++) {
      placements.push({
        id: nodesAtLevel[pos],
        level,
        position: pos,
      });
    }
  }

  return {
    direction,
    placements,
    maxLevel,
    maxPositions,
  };
}

/**
 * Assign levels to nodes using BFS
 */
function assignLevels(
  startNodes: string[],
  outgoing: Map<string, string[]>,
  allNodes: string[]
): Map<string, number> {
  const levels = new Map<string, number>();
  const visited = new Set<string>();
  const queue: Array<{ id: string; level: number }> = [];

  // Initialize with start nodes at level 0
  for (const id of startNodes) {
    queue.push({ id, level: 0 });
    levels.set(id, 0);
    visited.add(id);
  }

  // BFS to assign levels
  while (queue.length > 0) {
    const { id, level } = queue.shift()!;

    for (const neighbor of outgoing.get(id) || []) {
      const newLevel = level + 1;

      // Update level if this path gives a higher level (longest path)
      if (!visited.has(neighbor) || levels.get(neighbor)! < newLevel) {
        levels.set(neighbor, newLevel);

        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ id: neighbor, level: newLevel });
        }
      }
    }
  }

  // Handle any disconnected nodes
  for (const nodeId of allNodes) {
    if (!levels.has(nodeId)) {
      levels.set(nodeId, 0);
    }
  }

  return levels;
}

/**
 * Order nodes within levels to reduce edge crossings
 * Uses barycenter heuristic
 */
function orderNodesInLevels(
  levelGroups: Map<number, string[]>,
  edges: GraphDefinition['edges'],
  maxLevel: number
): void {
  // Build quick lookup for node positions
  const nodePositions = new Map<string, number>();

  // Initialize positions
  for (const [_level, nodes] of levelGroups) {
    for (let i = 0; i < nodes.length; i++) {
      nodePositions.set(nodes[i], i);
    }
  }

  // Iterate a few times to improve ordering
  for (let iteration = 0; iteration < 3; iteration++) {
    // Forward pass (level 0 to max)
    for (let level = 1; level <= maxLevel; level++) {
      orderLevel(level, levelGroups, edges, nodePositions, 'forward');
    }

    // Backward pass (max to level 0)
    for (let level = maxLevel - 1; level >= 0; level--) {
      orderLevel(level, levelGroups, edges, nodePositions, 'backward');
    }
  }
}

/**
 * Order nodes at a single level using barycenter method
 */
function orderLevel(
  level: number,
  levelGroups: Map<number, string[]>,
  edges: GraphDefinition['edges'],
  nodePositions: Map<string, number>,
  direction: 'forward' | 'backward'
): void {
  const nodesAtLevel = levelGroups.get(level);
  if (!nodesAtLevel || nodesAtLevel.length <= 1) return;

  // Calculate barycenter for each node
  const barycenters: Array<{ id: string; value: number }> = [];

  for (const nodeId of nodesAtLevel) {
    // Find connected nodes in adjacent level
    const connectedPositions: number[] = [];

    for (const edge of edges) {
      if (direction === 'forward') {
        // Look at incoming edges (from previous level)
        if (edge.to === nodeId) {
          const pos = nodePositions.get(edge.from);
          if (pos !== undefined) {
            connectedPositions.push(pos);
          }
        }
      } else {
        // Look at outgoing edges (to next level)
        if (edge.from === nodeId) {
          const pos = nodePositions.get(edge.to);
          if (pos !== undefined) {
            connectedPositions.push(pos);
          }
        }
      }
    }

    // Calculate barycenter (average position of connected nodes)
    let barycenter: number;
    if (connectedPositions.length > 0) {
      barycenter = connectedPositions.reduce((a, b) => a + b, 0) / connectedPositions.length;
    } else {
      // Keep original position if no connections
      barycenter = nodePositions.get(nodeId) || 0;
    }

    barycenters.push({ id: nodeId, value: barycenter });
  }

  // Sort by barycenter
  barycenters.sort((a, b) => a.value - b.value);

  // Update level group and positions
  const newOrder = barycenters.map(b => b.id);
  levelGroups.set(level, newOrder);

  for (let i = 0; i < newOrder.length; i++) {
    nodePositions.set(newOrder[i], i);
  }
}
