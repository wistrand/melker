/**
 * Mermaid Flowchart Parser
 *
 * Parses Mermaid flowchart syntax into GraphDefinition.
 * Supports a subset of Mermaid flowchart features.
 *
 * Supported syntax:
 * - Directions: flowchart TB, flowchart LR, flowchart BT, flowchart RL
 * - Node shapes: A[rect], A(rounded), A{diamond}, A((circle))
 * - Edges: -->, ---, -.->
 * - Edge labels: -->|label|, ---|label|
 */

import type { GraphDefinition, GraphNode, GraphEdge, GraphDirection, NodeShape, GraphSubgraph } from '../types.ts';
import type { GraphParser } from './types.ts';
import { GraphParseError } from './types.ts';

/** Parsed edge from Mermaid syntax */
interface ParsedEdge {
  from: string;
  to: string;
  label?: string;
  hasArrow: boolean;
  isDotted: boolean;
}

/** Subgraph parsing state */
interface SubgraphState {
  id: string;
  label?: string;
  nodes: string[];
}

/**
 * Extract %%melker:ID ... %%end blocks from input
 * Returns cleaned content and a map of node ID to melker XML
 *
 * Content lines can optionally be prefixed with %% for mermaid compatibility.
 * Example:
 *   %%melker:NodeA
 *   %%<button label="Click"/>
 *   %%end
 */
function extractMelkerBlocks(content: string): {
  cleanContent: string;
  nodeElements: Map<string, string>;
} {
  const nodeElements = new Map<string, string>();

  // Match %%melker:ID ... %%end blocks (handles indented content)
  // The pattern allows whitespace before %%melker and %%end
  const cleanContent = content.replace(
    /[ \t]*%%melker:(\w+)[ \t]*\r?\n([\s\S]*?)[ \t]*%%end/g,
    (_, nodeId: string, melkerXml: string) => {
      // Strip optional %% prefix from each content line (for mermaid compatibility)
      // The regex preserves leading whitespace while removing the %% prefix
      const strippedXml = melkerXml
        .split('\n')
        .map((line: string) => line.replace(/^(\s*)%%/, '$1'))
        .join('\n')
        .trim();
      nodeElements.set(nodeId, strippedXml);
      return ''; // Remove from mermaid content
    }
  );

  return { cleanContent, nodeElements };
}

/**
 * Mermaid flowchart parser
 */
export class MermaidParser implements GraphParser {
  parse(input: string): GraphDefinition {
    // Extract %%melker blocks before parsing
    const { cleanContent, nodeElements } = extractMelkerBlocks(input);

    const lines = cleanContent.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('%%'));

    if (lines.length === 0) {
      throw new GraphParseError('Empty input');
    }

    // Parse the first line for direction
    const direction = this._parseDirection(lines[0]);
    const startIndex = direction ? 1 : 0;

    // Parse nodes and edges from remaining lines
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const subgraphs: GraphSubgraph[] = [];

    // Track current subgraph stack (for nested subgraphs)
    const subgraphStack: SubgraphState[] = [];

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];

      // Parse subgraph start: "subgraph id" or "subgraph id [label]"
      const subgraphMatch = line.match(/^subgraph\s+(\S+)(?:\s*\[([^\]]+)\])?$/);
      if (subgraphMatch) {
        const subgraphId = subgraphMatch[1];
        const subgraphLabel = subgraphMatch[2]?.trim() || subgraphId;
        subgraphStack.push({
          id: subgraphId,
          label: subgraphLabel,
          nodes: [],
        });
        continue;
      }

      // Parse subgraph end
      if (line === 'end') {
        if (subgraphStack.length > 0) {
          const completedSubgraph = subgraphStack.pop()!;
          subgraphs.push({
            id: completedSubgraph.id,
            label: completedSubgraph.label,
            nodes: completedSubgraph.nodes,
          });
        }
        continue;
      }

      // Parse the line for nodes and edges
      const nodesBefore = new Set(nodes.keys());
      this._parseLine(line, nodes, edges);
      const nodesAfter = new Set(nodes.keys());

      // Track which nodes were added/referenced in current subgraph
      if (subgraphStack.length > 0) {
        const currentSubgraph = subgraphStack[subgraphStack.length - 1];
        for (const nodeId of nodesAfter) {
          if (!nodesBefore.has(nodeId) || this._lineReferencesNode(line, nodeId)) {
            if (!currentSubgraph.nodes.includes(nodeId)) {
              currentSubgraph.nodes.push(nodeId);
            }
          }
        }
      }
    }

    // Handle unclosed subgraphs (add them anyway)
    while (subgraphStack.length > 0) {
      const unclosed = subgraphStack.pop()!;
      subgraphs.push({
        id: unclosed.id,
        label: unclosed.label,
        nodes: unclosed.nodes,
      });
    }

    // Attach extracted melker elements to nodes
    const nodeArray = Array.from(nodes.values());
    for (const node of nodeArray) {
      const element = nodeElements.get(node.id);
      if (element) {
        node.element = element;
      }
    }

    return {
      direction: direction || 'TB',
      nodes: nodeArray,
      edges,
      subgraphs: subgraphs.length > 0 ? subgraphs : undefined,
    };
  }

  /** Check if a line references a specific node ID */
  private _lineReferencesNode(line: string, nodeId: string): boolean {
    // Check for node ID at word boundaries
    const pattern = new RegExp(`\\b${nodeId}\\b`);
    return pattern.test(line);
  }

  private _parseDirection(line: string): GraphDirection | null {
    // Match: flowchart TB, flowchart LR, graph TD, etc.
    const match = line.match(/^(?:flowchart|graph)\s+(TB|BT|LR|RL|TD)$/i);

    if (match) {
      let dir = match[1].toUpperCase();
      // TD is an alias for TB
      if (dir === 'TD') dir = 'TB';
      return dir as GraphDirection;
    }

    return null;
  }

  private _parseLine(line: string, nodes: Map<string, GraphNode>, edges: GraphEdge[]): void {
    // Handle chained edges: A --> B --> C
    // Split by arrows while preserving the arrow type for each edge
    const chainedEdges = this._parseChainedEdges(line);

    if (chainedEdges.length > 0) {
      for (const edge of chainedEdges) {
        const fromNode = this._parseNodePart(edge.from, nodes);
        const toNode = this._parseNodePart(edge.to, nodes);

        edges.push({
          from: fromNode.id,
          to: toNode.id,
          label: edge.label,
          arrowEnd: edge.hasArrow ? 'arrow' : 'none',
        });
      }
      return;
    }

    // Try to parse as standalone node definition
    const node = this._parseNodeDefinition(line);
    if (node) {
      nodes.set(node.id, node);
    }
  }

  /**
   * Parse a line that may contain chained edges: A --> B --> C
   * Returns array of edges found, or empty array if no edges
   *
   * Handles edge labels in two formats:
   * - Attached to arrow: A -->|label| B
   * - After arrow with space: A --> |label| B
   */
  private _parseChainedEdges(line: string): ParsedEdge[] {
    const edges: ParsedEdge[] = [];

    // Regex to find arrows with optional labels (attached or with space)
    // Matches: -->, ---, -.->, -->|label|, ---|label|, --> |label|, etc.
    const arrowPattern = /(-->|---|-\.->)\s*(?:\|([^|]*)\|)?/g;

    // Find all arrows and their positions
    const arrows: Array<{ arrow: string; label?: string; start: number; end: number }> = [];
    let match;
    while ((match = arrowPattern.exec(line)) !== null) {
      arrows.push({
        arrow: match[1],
        label: match[2]?.trim(),
        start: match.index,
        end: match.index + match[0].length,
      });
    }

    if (arrows.length === 0) {
      return [];
    }

    // Split the line into node parts based on arrow positions
    const parts: string[] = [];
    let lastEnd = 0;

    for (const arr of arrows) {
      parts.push(line.substring(lastEnd, arr.start).trim());
      lastEnd = arr.end;
    }
    // Add the final part after the last arrow
    parts.push(line.substring(lastEnd).trim());

    // Create edges between consecutive parts
    for (let i = 0; i < arrows.length; i++) {
      const fromPart = parts[i];
      let toPart = parts[i + 1];

      // Handle case where label is at the start of toPart: "|label| NodeId"
      // This can happen if the regex didn't fully capture the label
      let label = arrows[i].label;
      if (toPart) {
        const labelMatch = toPart.match(/^\|([^|]*)\|\s*(.*)$/);
        if (labelMatch) {
          label = labelMatch[1].trim();
          toPart = labelMatch[2].trim();
        }
      }

      if (fromPart && toPart) {
        edges.push({
          from: fromPart,
          to: toPart,
          label,
          hasArrow: arrows[i].arrow.includes('>'),
          isDotted: arrows[i].arrow.includes('.'),
        });
      }
    }

    return edges;
  }

  private _parseNodePart(part: string, nodes: Map<string, GraphNode>): GraphNode {
    // Check if this part defines a node with shape/label
    const node = this._parseNodeDefinition(part);

    if (node) {
      // Update or add the node
      if (!nodes.has(node.id)) {
        nodes.set(node.id, node);
      }
      return node;
    }

    // Plain ID reference
    const id = part.trim();
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        label: id,
        shape: 'rect',
      });
    }
    return nodes.get(id)!;
  }

  private _parseNodeDefinition(text: string): GraphNode | null {
    // Match various node shapes:
    // A[label] - rectangle
    // A(label) - rounded
    // A{label} - diamond
    // A((label)) - circle
    // A>label] - asymmetric (treat as rect)
    // A[[label]] - subroutine (treat as rect)
    // A[(label)] - cylindrical (treat as rect)
    // A{{label}} - hexagon

    const patterns: Array<{ pattern: RegExp; shape: NodeShape }> = [
      { pattern: /^([a-zA-Z_][a-zA-Z0-9_]*)\(\(([^)]+)\)\)$/, shape: 'circle' },     // A((label))
      { pattern: /^([a-zA-Z_][a-zA-Z0-9_]*)\{\{([^}]+)\}\}$/, shape: 'hexagon' },    // A{{label}}
      { pattern: /^([a-zA-Z_][a-zA-Z0-9_]*)\[\[([^\]]+)\]\]$/, shape: 'rect' },      // A[[label]]
      { pattern: /^([a-zA-Z_][a-zA-Z0-9_]*)\[\/([^\]\/]+)\/\]$/, shape: 'parallelogram' }, // A[/label/]
      { pattern: /^([a-zA-Z_][a-zA-Z0-9_]*)\[\\([^\]\\]+)\\\]$/, shape: 'parallelogram' }, // A[\label\]
      { pattern: /^([a-zA-Z_][a-zA-Z0-9_]*)\[([^\]]+)\]$/, shape: 'rect' },          // A[label]
      { pattern: /^([a-zA-Z_][a-zA-Z0-9_]*)\(([^)]+)\)$/, shape: 'rounded' },        // A(label)
      { pattern: /^([a-zA-Z_][a-zA-Z0-9_]*)\{([^}]+)\}$/, shape: 'diamond' },        // A{label}
      { pattern: /^([a-zA-Z_][a-zA-Z0-9_]*)>([^\]]+)\]$/, shape: 'rect' },           // A>label]
    ];

    for (const { pattern, shape } of patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          id: match[1],
          label: match[2].trim(),
          shape,
        };
      }
    }

    // Check for plain ID (letters/numbers/underscores only)
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text.trim())) {
      const id = text.trim();
      return {
        id,
        label: id,
        shape: 'rect',
      };
    }

    return null;
  }
}
