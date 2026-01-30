/**
 * Graph to Melker Converter
 *
 * Utility to convert mermaid or JSON graph definitions to .melker XML files.
 * This allows inspection and debugging of the generated structure.
 *
 * Usage:
 *   deno run --allow-read --allow-write src/components/graph/graph-to-melker.ts input.mmd output.melker
 *   deno run --allow-read --allow-write src/components/graph/graph-to-melker.ts --json input.json output.melker
 */

import type {
  GraphDefinition,
  GraphNode,
  GraphSubgraph,
  NodeShape,
  SequenceDefinition,
  SequenceEvent,
  SequenceArrowStyle,
  ClassDiagramDefinition,
  ClassNode,
  ClassMember,
  ClassRelation,
  ClassRelationType,
  ArrowStyle,
} from './types.ts';
import { getParser, getGraphParser, getSequenceParser, getClassDiagramParser, detectParserType, type ParserType } from './parsers/mod.ts';
import { calculateLayout } from './layout.ts';
import type { Style } from '../../types.ts';
import { getLogger } from '../../logging.ts';

const logger = getLogger('GraphToMelker');

/** Container options for the top-level element */
export interface ContainerOptions {
  /** Enable scrolling (default: true) */
  scrollable?: boolean;
  /** Container width (default: 'fill') */
  width?: string;
  /** Container height (default: 'fill') */
  height?: string;
}

/** Default container options */
const DEFAULT_CONTAINER_OPTIONS: Required<ContainerOptions> = {
  scrollable: true,
  width: 'fill',
  height: 'fill',
};

export interface GraphToMelkerOptions {
  /** Parser type: 'mermaid' or 'json' */
  type: ParserType;
  /** App name for the policy */
  name?: string;
  /** Top-level container options */
  container?: ContainerOptions;
  /** Use inline styles instead of CSS classes (for embedding in components) */
  inlineStyles?: boolean;
}

/**
 * Convert a style object to CSS-like string for style attribute
 */
function styleToString(style: Style): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;

    // Convert camelCase to kebab-case
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();

    if (typeof value === 'object') {
      // Handle padding/margin objects
      if ('top' in value || 'right' in value || 'bottom' in value || 'left' in value) {
        const t = value.top ?? 0;
        const r = value.right ?? 0;
        const b = value.bottom ?? 0;
        const l = value.left ?? 0;
        parts.push(`${cssKey}: ${t} ${r} ${b} ${l}`);
      }
    } else {
      parts.push(`${cssKey}: ${value}`);
    }
  }

  return parts.join('; ');
}

/**
 * Get border style string based on node shape
 */
function getBorderStyle(shape: NodeShape): string {
  switch (shape) {
    case 'diamond':
      return 'double';
    case 'hexagon':
      return 'thick';
    default:
      return 'thin';
  }
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Get CSS class name for node shape
 */
function getNodeClass(shape: NodeShape): string {
  switch (shape) {
    case 'diamond':
      return 'node node-diamond';
    case 'hexagon':
      return 'node node-hexagon';
    default:
      return 'node';
  }
}

/**
 * Get the content for a node - either custom element or default text
 * @param node The graph node
 * @param indentLevel The indentation level
 * @param indentFn The indentation function (local to each converter)
 */
function getNodeContent(node: GraphNode, indentLevel: number, indentFn: (level: number) => string): string {
  logger.debug('getNodeContent', { nodeId: node.id, hasElement: !!node.element, elementLength: node.element?.length });
  if (node.element) {
    // Use custom melker element(s) - indent each line
    return node.element
      .split('\n')
      .map((line: string) => indentFn(indentLevel) + line)
      .join('\n');
  }
  // Default: text with label
  return `${indentFn(indentLevel)}<text>${escapeXml(node.label)}</text>`;
}

/**
 * Get inline style for node based on shape
 */
function getNodeInlineStyle(shape: NodeShape): string {
  const base = 'border: thin; padding: 0 1';
  switch (shape) {
    case 'diamond':
      return 'border: double; padding: 0 1';
    case 'hexagon':
      return 'border: thick; padding: 0 1';
    default:
      return base;
  }
}

/**
 * Get inline style for graph container
 */
function getGraphInlineStyle(isHorizontal: boolean, containerOpts: Required<ContainerOptions>): string {
  const direction = isHorizontal ? 'row' : 'column';
  return `width: ${containerOpts.width}; height: ${containerOpts.height}; border: thin; padding: 1; display: flex; flex-direction: ${direction}; flex-wrap: wrap; gap: 5; align-items: flex-start; align-content: flex-start`;
}

/**
 * Get inline style for subgraph/branch container
 */
function getSubgraphInlineStyle(isHorizontal: boolean, noBorder: boolean = false): string {
  const direction = isHorizontal ? 'column' : 'row';
  if (noBorder) {
    return `display: flex; flex-direction: ${direction}; gap: 5`;
  }
  return `border: thin; padding: 1; display: flex; flex-direction: ${direction}; flex-wrap: wrap; gap: 4`;
}

/**
 * Convert a parsed graph definition to .melker XML
 * Auto-detects sequence diagrams and handles them separately
 */
export function graphToMelker(content: string, options: GraphToMelkerOptions): string {
  const { type: explicitType, name = 'Graph Output', container } = options;
  const containerOpts = { ...DEFAULT_CONTAINER_OPTIONS, ...container };

  // Auto-detect sequence diagrams
  const type = explicitType === 'mermaid' ? detectParserType(content) : explicitType;

  // Handle sequence diagrams
  if (type === 'sequence') {
    return sequenceToMelker(content, { name, container: containerOpts });
  }

  // Handle class diagrams
  if (type === 'class') {
    return classToMelker(content, { name, container: containerOpts });
  }

  // Parse the graph
  const parser = getGraphParser(type as 'json' | 'mermaid');
  const graph = parser.parse(content);
  const layout = calculateLayout(graph);

  const { nodes, edges, direction, subgraphs } = graph;
  const { placements, maxLevel } = layout;

  // Determine layout direction
  const isHorizontal = direction === 'LR' || direction === 'RL';
  const isReversed = direction === 'RL' || direction === 'BT';

  // Build node to subgraph mapping
  const nodeToSubgraph = new Map<string, GraphSubgraph>();
  if (subgraphs) {
    for (const sg of subgraphs) {
      for (const nodeId of sg.nodes) {
        nodeToSubgraph.set(nodeId, sg);
      }
    }
  }

  // Build adjacency info for branch detection
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

  // Group nodes by subgraph
  const subgraphNodes = new Map<string, typeof nodes>();

  // Group standalone nodes by level for branch handling
  const standaloneByLevel = new Map<number, typeof nodes>();

  for (let level = 0; level <= maxLevel; level++) {
    const actualLevel = isReversed ? maxLevel - level : level;
    const nodesAtLevel = placements.filter(p => p.level === actualLevel);
    nodesAtLevel.sort((a, b) => a.position - b.position);

    for (const placement of nodesAtLevel) {
      const node = nodes.find(n => n.id === placement.id);
      if (!node) continue;

      const sg = nodeToSubgraph.get(node.id);
      if (sg) {
        if (!subgraphNodes.has(sg.id)) {
          subgraphNodes.set(sg.id, []);
        }
        subgraphNodes.get(sg.id)!.push(node);
      } else {
        if (!standaloneByLevel.has(actualLevel)) {
          standaloneByLevel.set(actualLevel, []);
        }
        standaloneByLevel.get(actualLevel)!.push(node);
      }
    }
  }

  // Detect branch groups: multiple nodes at same level with common fork parent
  interface BranchGroup {
    level: number;
    forkParent: string | null;
    nodes: typeof nodes;
  }
  const branchGroups: BranchGroup[] = [];

  const sortedLevels = Array.from(standaloneByLevel.keys()).sort((a, b) => a - b);
  for (const level of sortedLevels) {
    const nodesAtLevel = standaloneByLevel.get(level)!;

    if (nodesAtLevel.length > 1) {
      // Check if they share a common fork parent
      const parents = new Set<string>();
      for (const node of nodesAtLevel) {
        const nodeParents = incoming.get(node.id) || [];
        for (const p of nodeParents) {
          // Check if parent is a fork (multiple outgoing edges)
          const parentOutgoing = outgoing.get(p) || [];
          if (parentOutgoing.length > 1) {
            parents.add(p);
          }
        }
      }

      if (parents.size === 1) {
        // All come from same fork parent - this is a branch group
        branchGroups.push({
          level,
          forkParent: Array.from(parents)[0],
          nodes: nodesAtLevel,
        });
      } else {
        // Multiple parents or no fork - still group them with toggled direction
        branchGroups.push({
          level,
          forkParent: null,
          nodes: nodesAtLevel,
        });
      }
    } else {
      // Single node - no branching
      branchGroups.push({
        level,
        forkParent: null,
        nodes: nodesAtLevel,
      });
    }
  }

  // Build XML output
  const lines: string[] = [];
  const indent = (level: number) => '  '.repeat(level);

  lines.push('<melker>');
  lines.push('<policy>');
  lines.push('{');
  lines.push(`  "name": "${escapeXml(name)}"`);
  lines.push('}');
  lines.push('</policy>');
  lines.push('');

  // Generate stylesheet
  lines.push('<style>');
  lines.push('.graph {');
  lines.push(`  width: ${containerOpts.width};`);
  lines.push(`  height: ${containerOpts.height};`);
  // lines.push('  border: thin;');
  lines.push('  padding: 1;');
  lines.push('  display: flex;');
  lines.push('  flex-wrap: wrap;');
  lines.push('  gap: 5;');
  lines.push('  align-items: flex-start;');
  lines.push('  align-content: flex-start;');
  lines.push('  flex-shrink: 0;');
  lines.push('}');
  lines.push('.graph-row { flex-direction: row; }');
  lines.push('.graph-col { flex-direction: column; }');
  lines.push('');
  lines.push('.subgraph {');
  lines.push('  border: thin;');
  lines.push('  padding: 1;');
  lines.push('  display: flex;');
  lines.push('  flex-wrap: wrap;');
  lines.push('  gap: 4;');
  lines.push('}');
  lines.push('.subgraph-row { flex-direction: row; }');
  lines.push('.subgraph-col { flex-direction: column; }');
  lines.push('');
  lines.push('.node {');
  lines.push('  border: thin;');
  lines.push('  padding: 0 1;');
  lines.push('  flex-shrink: 0;');
  lines.push('}');
  lines.push('.node-diamond { border: double; }');
  lines.push('.node-hexagon { border: thick; }');
  lines.push('</style>');
  lines.push('');

  // Top-level container
  const graphClass = isHorizontal ? 'graph graph-row' : 'graph graph-col';
  const scrollableAttr = containerOpts.scrollable ? ' scrollable="true"' : '';
  lines.push(`<container class="${graphClass}"${scrollableAttr}>`);

  // Generate subgraph containers
  if (subgraphs) {
    for (const sg of subgraphs) {
      const sgNodeList = subgraphNodes.get(sg.id) || [];
      if (sgNodeList.length === 0) continue;

      lines.push(`${indent(1)}<!-- Subgraph: ${escapeXml(sg.id)} -->`);
      const label = sg.label || sg.id;
      // Toggle direction: if graph is horizontal, subgraphs are vertical and vice versa
      const subgraphClass = isHorizontal ? 'subgraph subgraph-col' : 'subgraph subgraph-row';
      lines.push(`${indent(1)}<container id="graph-subgraph-${sg.id}" class="${subgraphClass}" style="border-title: ${escapeXml(label)}">`);

      // Individual nodes
      for (const node of sgNodeList) {
        const nodeClass = getNodeClass(node.shape);
        lines.push(`${indent(2)}<container id="graph-node-${node.id}" class="${nodeClass}">`);
        lines.push(getNodeContent(node, 3, indent));
        lines.push(`${indent(2)}</container>`);
      }

      lines.push(`${indent(1)}</container>`);
      lines.push('');
    }
  }

  // Generate standalone nodes by level, with branch groups in toggled-direction sub-containers
  for (const group of branchGroups) {
    if (group.nodes.length === 0) continue;

    if (group.nodes.length > 1) {
      // Multiple nodes at this level - wrap in toggled-direction sub-container
      // Use larger gap to leave room for connector labels
      const branchClass = isHorizontal ? 'subgraph subgraph-col' : 'subgraph subgraph-row';
      lines.push(`${indent(1)}<container class="${branchClass}" style="border: none; padding: 0; gap: 5">`);

      for (const node of group.nodes) {
        const nodeClass = getNodeClass(node.shape);
        lines.push(`${indent(2)}<container id="graph-node-${node.id}" class="${nodeClass}">`);
        lines.push(getNodeContent(node, 3, indent));
        lines.push(`${indent(2)}</container>`);
      }

      lines.push(`${indent(1)}</container>`);
    } else {
      // Single node - render directly
      const node = group.nodes[0];
      const nodeClass = getNodeClass(node.shape);
      lines.push(`${indent(1)}<container id="graph-node-${node.id}" class="${nodeClass}">`);
      lines.push(getNodeContent(node, 2, indent));
      lines.push(`${indent(1)}</container>`);
    }
  }

  // Generate connectors (inside top-level container)
  if (edges.length > 0) {
    lines.push('');
    lines.push(`${indent(1)}<!-- Connectors -->`);
    for (const edge of edges) {
      const arrow = edge.arrowEnd === 'none' ? 'none' : 'end';
      const labelAttr = edge.label ? ` label="${escapeXml(edge.label)}"` : '';
      lines.push(`${indent(1)}<connector from="graph-node-${edge.from}" to="graph-node-${edge.to}" arrow="${arrow}"${labelAttr} />`);
    }
  }

  lines.push('</container>');
  lines.push('</melker>');

  return lines.join('\n');
}

/**
 * Convert a sequence diagram definition to .melker XML
 * Uses a table for participant columns; connectors draw between columns
 */
export function sequenceToMelker(content: string, options: { name?: string; container?: ContainerOptions } = {}): string {
  const { name = 'Sequence Diagram', container } = options;
  const containerOpts = { ...DEFAULT_CONTAINER_OPTIONS, ...container };

  const parser = getSequenceParser();
  const seq = parser.parse(content);

  const lines: string[] = [];
  const connectors: string[] = []; // Collect connectors to add after table
  const indent = (level: number) => '  '.repeat(level);

  // Total columns = number of participants
  const totalCols = seq.participants.length;

  // Calculate the longest message label to determine cellPadding
  let maxLabelLen = 0;
  const getParticipantIdx = (id: string) => seq.participants.findIndex(p => p.id === id);

  const processEvents = (events: SequenceEvent[]) => {
    for (const event of events) {
      if (event.type === 'message' && event.message.label) {
        const fromIdx = getParticipantIdx(event.message.from);
        const toIdx = getParticipantIdx(event.message.to);
        if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
          const spanCols = Math.abs(toIdx - fromIdx);
          // Each column in the span needs (labelLen / spanCols) width
          const widthPerCol = Math.ceil(event.message.label.length / spanCols);
          maxLabelLen = Math.max(maxLabelLen, widthPerCol);
        }
      } else if (event.type === 'fragment') {
        for (const section of event.fragment.sections) {
          processEvents(section.events);
        }
      }
    }
  };
  processEvents(seq.events);

  // Calculate cellPadding needed: half the max label length on each side, minus default padding
  const cellPadding = Math.max(1, Math.ceil(maxLabelLen / 2) + 2);

  lines.push('<melker>');
  lines.push('<policy>');
  lines.push('{');
  lines.push(`  "name": "${escapeXml(name)}"`);
  lines.push('}');
  lines.push('</policy>');
  lines.push('');

  // Generate stylesheet for sequence diagrams
  lines.push('<style>');
  lines.push('.sequence-container {');
  lines.push(`  width: ${containerOpts.width};`);
  lines.push('  height: auto;');  // Use auto height so table can grow
//  lines.push('  border: thin;');
  lines.push('  padding: 1;');
  lines.push('}');
  lines.push('.sequence-table {');
  lines.push('  width: fill;');
  lines.push('}');
  lines.push('.participant {');
  lines.push('  text-align: center;');
  lines.push('}');
  lines.push('.actor {');
  lines.push('  text-align: center;');
  lines.push('}');
  lines.push('.lifeline {');
  lines.push('  text-align: center;');
  lines.push('}');
  lines.push('.note {');
  lines.push('  text-align: center;');
  lines.push('}');
  lines.push('</style>');
  lines.push('');

  // Root container for the sequence diagram (table + connectors must be siblings)
  // KNOWN ISSUE: Tables inside containers may not render all rows properly
  // Using flex-direction: column to help with layout
  const scrollableAttr = containerOpts.scrollable ? ' scrollable="true"' : '';
  lines.push(`<container style="padding: 1; flex-direction: column"${scrollableAttr}>`);

  // Title if present
  if (seq.title) {
    lines.push(`${indent(1)}<text style="text-align: center; padding-bottom: 1">${escapeXml(seq.title)}</text>`);
  }

  // Use a table for the sequence diagram with calculated cellPadding for message labels
  lines.push(`${indent(1)}<table class="sequence-table" border="none" columnBorders="false" cellPadding="${cellPadding}">`);

  // Header row with participant names
  lines.push(`${indent(2)}<thead>`);
  lines.push(`${indent(3)}<tr>`);
  for (const p of seq.participants) {
    const className = p.type === 'actor' ? 'actor' : 'participant';
    lines.push(`${indent(4)}<th id="seq-${p.id}" class="${className}">${escapeXml(p.label)}</th>`);
  }
  lines.push(`${indent(3)}</tr>`);
  lines.push(`${indent(2)}</thead>`);

  // Body with lifelines and messages
  lines.push(`${indent(2)}<tbody>`);

  // Helper to generate a row with lifelines
  // Uses container with border-left for the lifeline, ID on container for connector alignment
  const generateLifelineRow = (
    msgIndex: number,
    fromIdx: number,
    toIdx: number,
    fromId: string,
    toId: string
  ) => {
    lines.push(`${indent(3)}<tr>`);
    for (let i = 0; i < seq.participants.length; i++) {
      const isFrom = i === fromIdx;
      const isTo = i === toIdx;

      // Participant column with lifeline - ID on container for connector alignment
      if (isFrom) {
        lines.push(`${indent(4)}<td class="lifeline"><container id="seq-msg-${msgIndex}-${fromId}" style="border-left: thin"><text text="" /></container></td>`);
      } else if (isTo) {
        lines.push(`${indent(4)}<td class="lifeline"><container id="seq-msg-${msgIndex}-${toId}" style="border-left: thin"><text text="" /></container></td>`);
      } else {
        lines.push(`${indent(4)}<td class="lifeline"><container style="border-left: thin"><text text="" /></container></td>`);
      }
    }
    lines.push(`${indent(3)}</tr>`);
  };

  // Generate lifelines and messages
  let messageIndex = 0;
  for (const event of seq.events) {
    if (event.type === 'message') {
      const msg = event.message;
      const fromIdx = seq.participants.findIndex(p => p.id === msg.from);
      const toIdx = seq.participants.findIndex(p => p.id === msg.to);

      if (fromIdx >= 0 && toIdx >= 0) {
        lines.push(`${indent(3)}<!-- ${escapeXml(msg.from)} -> ${escapeXml(msg.to)}: ${escapeXml(msg.label)} -->`);
        generateLifelineRow(messageIndex, fromIdx, toIdx, msg.from, msg.to);

        // Collect connector for the message
        const arrow = getSequenceArrow(msg.arrow);
        const lineStyle = msg.arrow === 'dashed' || msg.arrow === 'dashedOpen' ? 'dashed' : 'thin';
        const labelAttr = msg.label ? ` label="${escapeXml(msg.label)}"` : '';
        const styleAttr = lineStyle === 'dashed' ? ' style="line-style: dashed"' : '';

        if (fromIdx !== toIdx) {
          connectors.push(`${indent(1)}<connector from="seq-msg-${messageIndex}-${msg.from}" to="seq-msg-${messageIndex}-${msg.to}" routing="horizontal" arrow="${arrow}"${labelAttr}${styleAttr} />`);
        }

        messageIndex++;
      }
    } else if (event.type === 'note') {
      const note = event.note;

      lines.push(`${indent(3)}<!-- Note: ${escapeXml(note.text)} -->`);
      lines.push(`${indent(3)}<tr>`);

      for (let i = 0; i < seq.participants.length; i++) {
        const p = seq.participants[i];
        const isTarget = note.participants.includes(p.id);

        if (isTarget && (note.position === 'over' || note.position === 'right')) {
          // Note cell: container with border-left maintains lifeline, text wraps inside
          lines.push(`${indent(4)}<td class="note"><container style="border-left: thin"><text style="text-wrap: wrap">${escapeXml(note.text)}</text></container></td>`);
        } else {
          lines.push(`${indent(4)}<td class="lifeline"><container style="border-left: thin"><text text="" /></container></td>`);
        }
      }

      lines.push(`${indent(3)}</tr>`);
    } else if (event.type === 'fragment') {
      const frag = event.fragment;
      lines.push(`${indent(3)}<!-- Fragment: ${frag.type} -->`);
      lines.push(`${indent(3)}<tr>`);
      lines.push(`${indent(4)}<td colspan="${totalCols}">[${escapeXml(frag.type)}${frag.label ? ' ' + escapeXml(frag.label) : ''}]</td>`);
      lines.push(`${indent(3)}</tr>`);

      // Render fragment events
      for (const section of frag.sections) {
        if (section.label && frag.sections.indexOf(section) > 0) {
          lines.push(`${indent(3)}<tr>`);
          lines.push(`${indent(4)}<td colspan="${totalCols}">[else${section.label ? ' ' + escapeXml(section.label) : ''}]</td>`);
          lines.push(`${indent(3)}</tr>`);
        }
        for (const subEvent of section.events) {
          if (subEvent.type === 'message') {
            const msg = subEvent.message;
            const subFromIdx = seq.participants.findIndex(p => p.id === msg.from);
            const subToIdx = seq.participants.findIndex(p => p.id === msg.to);

            if (subFromIdx >= 0 && subToIdx >= 0) {
              generateLifelineRow(messageIndex, subFromIdx, subToIdx, msg.from, msg.to);

              if (subFromIdx !== subToIdx) {
                const arrow = getSequenceArrow(msg.arrow);
                const labelAttr = msg.label ? ` label="${escapeXml(msg.label)}"` : '';
                connectors.push(`${indent(1)}<connector from="seq-msg-${messageIndex}-${msg.from}" to="seq-msg-${messageIndex}-${msg.to}" routing="horizontal" arrow="${arrow}"${labelAttr} />`);
              }
              messageIndex++;
            }
          }
        }
      }

      lines.push(`${indent(3)}<tr>`);
      lines.push(`${indent(4)}<td colspan="${totalCols}">[end]</td>`);
      lines.push(`${indent(3)}</tr>`);
    }
  }

  lines.push(`${indent(2)}</tbody>`);

  // Footer row with participant names
  lines.push(`${indent(2)}<tfoot>`);
  lines.push(`${indent(3)}<tr>`);
  for (const p of seq.participants) {
    const className = p.type === 'actor' ? 'actor' : 'participant';
    lines.push(`${indent(4)}<td id="seq-bottom-${p.id}" class="${className}">${escapeXml(p.label)}</td>`);
  }
  lines.push(`${indent(3)}</tr>`);
  lines.push(`${indent(2)}</tfoot>`);

  lines.push(`${indent(1)}</table>`);

  // Add connectors after the table
  if (connectors.length > 0) {
    lines.push('');
    lines.push(`${indent(1)}<!-- Message connectors -->`);
    for (const connector of connectors) {
      lines.push(connector);
    }
  }

  lines.push('</container>');
  lines.push('</melker>');

  return lines.join('\n');
}

/**
 * Convert a class diagram definition to .melker XML
 * Uses flex layout similar to flowcharts
 */
export function classToMelker(content: string, options: { name?: string; container?: ContainerOptions } = {}): string {
  const { name = 'Class Diagram', container } = options;
  const containerOpts = { ...DEFAULT_CONTAINER_OPTIONS, ...container };

  const parser = getClassDiagramParser();
  const diagram = parser.parse(content);

  // Convert to graph for layout calculation
  const graphDef: GraphDefinition = {
    direction: diagram.direction || 'TB',
    nodes: diagram.classes.map(c => ({
      id: c.id,
      label: c.label || c.id,
      shape: 'rect' as NodeShape,
    })),
    edges: diagram.relations.map(r => ({
      from: r.from,
      to: r.to,
      label: r.label,
      arrowEnd: 'arrow' as ArrowStyle,
    })),
  };

  const layout = calculateLayout(graphDef);
  const { placements, maxLevel } = layout;

  // Determine layout direction
  const isHorizontal = graphDef.direction === 'LR' || graphDef.direction === 'RL';
  const isReversed = graphDef.direction === 'RL' || graphDef.direction === 'BT';

  const lines: string[] = [];
  const indent = (level: number) => '  '.repeat(level);

  lines.push('<melker>');
  lines.push('<policy>');
  lines.push('{');
  lines.push(`  "name": "${escapeXml(name)}"`);
  lines.push('}');
  lines.push('</policy>');
  lines.push('');

  // Generate stylesheet for class diagrams
  lines.push('<style>');
  lines.push('.class-diagram {');
  lines.push(`  width: ${containerOpts.width};`);
  lines.push(`  height: ${containerOpts.height};`);
  // lines.push('  border: thin;');
  lines.push('  padding: 1;');
  lines.push('  display: flex;');
  lines.push('  flex-direction: column;');
  lines.push('  gap: 3;');
  lines.push('}');
  lines.push('.class-diagram-row { flex-direction: row; }');
  lines.push('.class-diagram-col { flex-direction: column; }');
  lines.push('');
  lines.push('.class-level {');
  lines.push('  display: flex;');
  lines.push('  gap: 3;');
  lines.push('}');
  lines.push('.class-level-row { flex-direction: row; }');
  lines.push('.class-level-col { flex-direction: column; }');
  lines.push('');
  // Note: class-box uses inline styles instead of CSS class for proper separator support
  lines.push('.class-annotation {');
  lines.push('  text-align: center;');
  lines.push('}');
  lines.push('.class-name {');
  lines.push('  text-align: center;');
  lines.push('  font-weight: bold;');
  lines.push('}');
  lines.push('</style>');
  lines.push('');

  // Top-level container
  const diagramClass = isHorizontal ? 'class-diagram class-diagram-row' : 'class-diagram class-diagram-col';
  const scrollableAttr = containerOpts.scrollable ? ' scrollable="true"' : '';
  lines.push(`<container class="${diagramClass}"${scrollableAttr}>`);

  // Group classes by level
  const levelMap = new Map<number, ClassNode[]>();
  for (const placement of placements) {
    const actualLevel = isReversed ? maxLevel - placement.level : placement.level;
    const classNode = diagram.classes.find(c => c.id === placement.id);
    if (classNode) {
      if (!levelMap.has(actualLevel)) {
        levelMap.set(actualLevel, []);
      }
      levelMap.get(actualLevel)!.push(classNode);
    }
  }

  // Sort levels and render
  const sortedLevels = Array.from(levelMap.keys()).sort((a, b) => a - b);
  for (const level of sortedLevels) {
    const classesAtLevel = levelMap.get(level)!;
    // Toggle direction for levels (perpendicular to main direction)
    const levelClass = isHorizontal ? 'class-level class-level-col' : 'class-level class-level-row';

    lines.push(`${indent(1)}<container class="${levelClass}">`);

    for (const cls of classesAtLevel) {
      // Use inline style for flex column to ensure separator works correctly
      lines.push(`${indent(2)}<container id="class-${cls.id}" style="display: flex; flex-direction: column; align-items: stretch; border: thin; padding: 0 1">`);

      // Header: annotation + name
      if (cls.annotation) {
        // Use guillemets to avoid XML parsing issues with < and >
        const annotationText = `«${cls.annotation}»`;
        lines.push(`${indent(3)}<text class="class-annotation">${annotationText}</text>`);
      }
      lines.push(`${indent(3)}<text class="class-name">${escapeXml(cls.label || cls.id)}</text>`);

      // Split members into attributes and methods
      const attributes = cls.members.filter(m => !m.isMethod);
      const methods = cls.members.filter(m => m.isMethod);

      // Separator after header if there are members
      if (attributes.length > 0 || methods.length > 0) {
        lines.push(`${indent(3)}<separator />`);
      }

      // Attributes
      if (attributes.length > 0) {
        for (const attr of attributes) {
          const memberStr = formatClassMember(attr);
          lines.push(`${indent(3)}<text>${escapeXml(memberStr)}</text>`);
        }
      } else if (methods.length > 0) {
        // Empty space if no attributes but have methods
        lines.push(`${indent(3)}<text> </text>`);
      }

      // Separator before methods
      if (methods.length > 0) {
        lines.push(`${indent(3)}<separator />`);
        for (const method of methods) {
          const memberStr = formatClassMember(method);
          lines.push(`${indent(3)}<text>${escapeXml(memberStr)}</text>`);
        }
      }

      lines.push(`${indent(2)}</container>`);
    }

    lines.push(`${indent(1)}</container>`);
  }

  // Generate connectors for relationships
  if (diagram.relations.length > 0) {
    lines.push('');
    lines.push(`${indent(1)}<!-- Relationships -->`);
    for (const rel of diagram.relations) {
      const { lineStyle, labelPrefix } = getRelationStyle(rel.type);
      const arrow = getRelationArrow(rel.type);

      // Build label with cardinality and relationship label
      let label = '';
      if (labelPrefix) {
        label = labelPrefix;
      }
      if (rel.fromCardinality || rel.toCardinality || rel.label) {
        const parts: string[] = [];
        if (rel.fromCardinality) parts.push(rel.fromCardinality);
        if (rel.label) parts.push(rel.label);
        if (rel.toCardinality) parts.push(rel.toCardinality);
        if (label) {
          label = label + ' ' + parts.join(' ');
        } else {
          label = parts.join(' ');
        }
      }

      const labelAttr = label ? ` label="${escapeXml(label)}"` : '';
      const styleAttr = lineStyle === 'dashed' ? ' style="line-style: dashed"' : '';

      lines.push(`${indent(1)}<connector from="class-${rel.from}" to="class-${rel.to}" arrow="${arrow}"${labelAttr}${styleAttr} />`);
    }
  }

  lines.push('</container>');
  lines.push('</melker>');

  return lines.join('\n');
}

/**
 * Format a class member for display
 */
function formatClassMember(member: ClassMember): string {
  const parts: string[] = [];

  // Visibility prefix
  switch (member.visibility) {
    case 'public': parts.push('+'); break;
    case 'private': parts.push('-'); break;
    case 'protected': parts.push('#'); break;
    case 'package': parts.push('~'); break;
  }

  // Name and type/parameters
  if (member.isMethod) {
    const params = member.parameters || '';
    if (member.type) {
      parts.push(`${member.name}(${params}): ${member.type}`);
    } else {
      parts.push(`${member.name}(${params})`);
    }
  } else {
    if (member.type) {
      parts.push(`${member.name}: ${member.type}`);
    } else {
      parts.push(member.name);
    }
  }

  // Classifier suffix
  if (member.classifier === 'abstract') {
    parts.push('*');
  } else if (member.classifier === 'static') {
    parts.push('$');
  }

  return parts.join('');
}

/**
 * Get line style and label prefix for relationship type
 */
function getRelationStyle(type: ClassRelationType): { lineStyle: 'thin' | 'dashed'; labelPrefix: string } {
  switch (type) {
    case 'inheritance':
      return { lineStyle: 'thin', labelPrefix: '' };
    case 'composition':
      return { lineStyle: 'thin', labelPrefix: '◆' };
    case 'aggregation':
      return { lineStyle: 'thin', labelPrefix: '◇' };
    case 'association':
      return { lineStyle: 'thin', labelPrefix: '' };
    case 'dependency':
      return { lineStyle: 'dashed', labelPrefix: '' };
    case 'realization':
      return { lineStyle: 'dashed', labelPrefix: '' };
    case 'link':
      return { lineStyle: 'thin', labelPrefix: '' };
    case 'linkDashed':
      return { lineStyle: 'dashed', labelPrefix: '' };
    default:
      return { lineStyle: 'thin', labelPrefix: '' };
  }
}

/**
 * Get arrow setting for relationship type
 */
function getRelationArrow(type: ClassRelationType): 'end' | 'none' | 'start' {
  switch (type) {
    case 'inheritance':
    case 'association':
    case 'dependency':
    case 'realization':
      return 'end';
    case 'composition':
    case 'aggregation':
      return 'end';
    case 'link':
    case 'linkDashed':
      return 'none';
    default:
      return 'end';
  }
}

/**
 * Get arrow type for connector based on sequence arrow style
 */
function getSequenceArrow(arrow: SequenceArrowStyle): 'end' | 'none' | 'both' {
  return arrow === 'solidOpen' || arrow === 'dashedOpen' ? 'end' : 'end';
}

/**
 * Get arrow character for text representation
 */
function getArrowChar(arrow: SequenceArrowStyle): string {
  switch (arrow) {
    case 'solid': return '->>';
    case 'dashed': return '-->>';
    case 'solidOpen': return '->';
    case 'dashedOpen': return '-->';
    default: return '->>';
  }
}

/**
 * Parse graph and return the parsed definition (for --parsed flag)
 */
export function parseGraph(content: string, type: ParserType): GraphDefinition | SequenceDefinition | ClassDiagramDefinition {
  if (type === 'sequence') {
    return getSequenceParser().parse(content);
  }
  if (type === 'class') {
    return getClassDiagramParser().parse(content);
  }
  return getGraphParser(type as 'json' | 'mermaid').parse(content);
}

/**
 * Replace file extension, keeping the directory path
 */
function changeExtension(filePath: string, newExt: string): string {
  const dotIndex = filePath.lastIndexOf('.');
  const pathWithoutExt = dotIndex >= 0 ? filePath.substring(0, dotIndex) : filePath;
  return pathWithoutExt + newExt;
}

/**
 * Process a single input file
 */
async function processFile(
  inputFile: string,
  outputFile: string | undefined,
  outputParsed: boolean,
  containerOpts: ContainerOptions = {}
): Promise<void> {
  const content = await Deno.readTextFile(inputFile);

  // Detect type: JSON by extension, otherwise auto-detect from content
  let type: ParserType;
  if (inputFile.endsWith('.json')) {
    type = 'json';
  } else {
    type = detectParserType(content);
  }

  let output: string;
  if (outputParsed) {
    const parsed = parseGraph(content, type);
    output = JSON.stringify(parsed, null, 2);
  } else {
    const typeNames: Record<ParserType, string> = {
      sequence: 'Sequence',
      class: 'Class Diagram',
      mermaid: 'Graph',
      json: 'Graph',
    };
    output = graphToMelker(content, { type, name: `${typeNames[type]}: ${inputFile}`, container: containerOpts });
  }

  if (outputFile) {
    await Deno.writeTextFile(outputFile, output);
    console.error(`Wrote ${outputFile}`);
  } else {
    console.log(output);
  }
}

/**
 * Parse a flag with value from args (e.g., --width=100 or --width 100)
 * Returns the value and removes the flag from args
 */
function parseFlag(args: string[], flag: string): string | undefined {
  // Check for --flag=value format
  const eqIdx = args.findIndex(a => a.startsWith(`${flag}=`));
  if (eqIdx !== -1) {
    const value = args[eqIdx].substring(flag.length + 1);
    args.splice(eqIdx, 1);
    return value;
  }

  // Check for --flag value format
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('-')) {
    const value = args[idx + 1];
    args.splice(idx, 2);
    return value;
  }

  return undefined;
}

/**
 * Check for boolean flag and remove from args
 */
function parseBoolFlag(args: string[], flag: string, defaultValue: boolean = false): boolean {
  const idx = args.indexOf(flag);
  if (idx !== -1) {
    args.splice(idx, 1);
    return true;
  }

  // Check for --flag=true/false format
  const eqIdx = args.findIndex(a => a.startsWith(`${flag}=`));
  if (eqIdx !== -1) {
    const value = args[eqIdx].substring(flag.length + 1).toLowerCase();
    args.splice(eqIdx, 1);
    return value === 'true' || value === '1';
  }

  return defaultValue;
}

// CLI entry point
if (import.meta.main) {
  const args = [...Deno.args];

  // Check for --parsed flag
  const outputParsed = parseBoolFlag(args, '--parsed');

  // Check for --inputs flag (batch mode)
  const batchMode = parseBoolFlag(args, '--inputs');

  // Check for --no-scrollable flag (default is scrollable=true)
  const noScrollable = parseBoolFlag(args, '--no-scrollable');

  // Check for container options
  const width = parseFlag(args, '--width') || 'fill';
  const height = parseFlag(args, '--height') || 'fill';

  const containerOpts: ContainerOptions = {
    scrollable: !noScrollable,
    width,
    height,
  };

  if (args.length < 1) {
    console.log('Usage: graph-to-melker.ts [options] <input> [output]');
    console.log('       graph-to-melker.ts --inputs <file1> <file2> ...');
    console.log('');
    console.log('Options:');
    console.log('  --parsed        Output parsed graph as JSON (instead of .melker XML)');
    console.log('  --inputs        Batch mode: convert multiple files, output next to input files');
    console.log('  --no-scrollable Disable scrollable on top-level container (default: scrollable)');
    console.log('  --width=VALUE   Set container width (default: fill)');
    console.log('  --height=VALUE  Set container height (default: fill)');
    console.log('');
    console.log('Supported diagram types (auto-detected from content):');
    console.log('  - Mermaid flowcharts: flowchart TB, graph LR, etc.');
    console.log('  - Mermaid sequence diagrams: sequenceDiagram');
    console.log('  - Mermaid class diagrams: classDiagram');
    console.log('  - JSON graph definitions (.json extension)');
    console.log('');
    console.log('If output is omitted in single-file mode, writes to stdout.');
    console.log('');
    console.log('Examples:');
    console.log('  deno run --allow-read graph-to-melker.ts flowchart.mmd');
    console.log('  deno run --allow-read graph-to-melker.ts sequence.mmd');
    console.log('  deno run --allow-read graph-to-melker.ts classdiagram.mmd');
    console.log('  deno run --allow-read graph-to-melker.ts --parsed diagram.mmd');
    console.log('  deno run --allow-read --allow-write graph-to-melker.ts diagram.mmd output.melker');
    console.log('  deno run --allow-read --allow-write graph-to-melker.ts --inputs tests/mermaid/*.mmd');
    console.log('  deno run --allow-read graph-to-melker.ts --no-scrollable --width=80 diagram.mmd');
    Deno.exit(1);
  }

  try {
    if (batchMode) {
      // Batch mode: process all input files, output next to input
      const ext = outputParsed ? '.json' : '.melker';
      for (const inputFile of args) {
        const outputFile = changeExtension(inputFile, ext);
        await processFile(inputFile, outputFile, outputParsed, containerOpts);
      }
    } else {
      // Single file mode
      const inputFile = args[0];
      const outputFile = args[1];
      await processFile(inputFile, outputFile, outputParsed, containerOpts);
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
