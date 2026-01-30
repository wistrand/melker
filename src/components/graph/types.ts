/**
 * Graph Component Types
 *
 * Neutral graph format used by all parsers and the layout engine.
 */

import type { Style } from '../../types.ts';

/** Graph direction for layout */
export type GraphDirection = 'TB' | 'LR' | 'BT' | 'RL';

/** Node shape for rendering */
export type NodeShape = 'rect' | 'rounded' | 'diamond' | 'circle' | 'ellipse' | 'hexagon' | 'parallelogram';

/** Arrow style for edges */
export type ArrowStyle = 'none' | 'arrow' | 'open' | 'dot';

/**
 * A node in the graph
 */
export interface GraphNode {
  /** Unique identifier for the node */
  id: string;
  /** Display label (defaults to id if not specified) */
  label: string;
  /** Node shape for rendering */
  shape: NodeShape;
  /** Optional custom style */
  style?: Style;
  /** Optional raw melker XML to use instead of <text>label</text> */
  element?: string;
}

/**
 * An edge connecting two nodes
 */
export interface GraphEdge {
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Optional edge label */
  label?: string;
  /** Arrow at start of edge */
  arrowStart?: ArrowStyle;
  /** Arrow at end of edge (default: 'arrow') */
  arrowEnd?: ArrowStyle;
  /** Optional custom style */
  style?: Style;
}

/**
 * A subgraph (grouping of nodes)
 */
export interface GraphSubgraph {
  /** Unique identifier for the subgraph */
  id: string;
  /** Display label */
  label?: string;
  /** Node IDs contained in this subgraph */
  nodes: string[];
  /** Optional custom style */
  style?: Style;
}

/**
 * Complete graph definition - the neutral format used by all parsers
 */
export interface GraphDefinition {
  /** Layout direction */
  direction: GraphDirection;
  /** All nodes in the graph */
  nodes: GraphNode[];
  /** All edges connecting nodes */
  edges: GraphEdge[];
  /** Optional subgraphs for grouping */
  subgraphs?: GraphSubgraph[];
}

/**
 * Node placement after layout calculation
 */
export interface NodePlacement {
  /** Node ID */
  id: string;
  /** Level (column for LR/RL, row for TB/BT) */
  level: number;
  /** Position within the level */
  position: number;
}

/**
 * Complete layout result
 */
export interface GraphLayout {
  /** Direction of the graph */
  direction: GraphDirection;
  /** Placement for each node */
  placements: NodePlacement[];
  /** Maximum level (for sizing) */
  maxLevel: number;
  /** Maximum positions per level (for sizing) */
  maxPositions: number;
}

// ============================================================================
// Sequence Diagram Types
// ============================================================================

/**
 * A participant in a sequence diagram (actor or object)
 */
export interface SequenceParticipant {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Type: actor (stick figure style) or participant (box) */
  type: 'actor' | 'participant';
}

/**
 * Arrow style for sequence diagram messages
 */
export type SequenceArrowStyle =
  | 'solid'        // ->>  solid line with filled arrow
  | 'dashed'       // -->> dashed line with filled arrow
  | 'solidOpen'    // -)   solid line with open arrow
  | 'dashedOpen';  // --)  dashed line with open arrow

/**
 * A message between participants
 */
export interface SequenceMessage {
  /** Source participant ID */
  from: string;
  /** Target participant ID */
  to: string;
  /** Message label */
  label: string;
  /** Arrow style */
  arrow: SequenceArrowStyle;
  /** Whether this activates the target */
  activate?: boolean;
  /** Whether this deactivates the source */
  deactivate?: boolean;
}

/**
 * A note attached to participants
 */
export interface SequenceNote {
  /** Position relative to participants */
  position: 'left' | 'right' | 'over';
  /** Participant IDs this note is attached to */
  participants: string[];
  /** Note text */
  text: string;
}

/**
 * Type of combined fragment (loop, alt, opt, etc.)
 */
export type FragmentType = 'loop' | 'alt' | 'opt' | 'par' | 'critical' | 'break';

/**
 * A section within a combined fragment (for alt/else)
 */
export interface FragmentSection {
  /** Section label (condition text) */
  label?: string;
  /** Events within this section */
  events: SequenceEvent[];
}

/**
 * A combined fragment (loop, alt, opt, etc.)
 */
export interface SequenceFragment {
  /** Fragment type */
  type: FragmentType;
  /** Label (e.g., loop condition) */
  label?: string;
  /** Sections (multiple for alt/else, single for others) */
  sections: FragmentSection[];
}

/**
 * An event in the sequence (message, note, fragment, activation)
 */
export type SequenceEvent =
  | { type: 'message'; message: SequenceMessage }
  | { type: 'note'; note: SequenceNote }
  | { type: 'fragment'; fragment: SequenceFragment }
  | { type: 'activate'; participant: string }
  | { type: 'deactivate'; participant: string };

/**
 * Complete sequence diagram definition
 */
export interface SequenceDefinition {
  /** Diagram type marker */
  diagramType: 'sequence';
  /** Participants in order */
  participants: SequenceParticipant[];
  /** Events in order */
  events: SequenceEvent[];
  /** Optional title */
  title?: string;
}

// ============================================================================
// Class Diagram Types
// ============================================================================

/** Visibility modifiers for class members */
export type ClassMemberVisibility = 'public' | 'private' | 'protected' | 'package';

/** Member classifiers (abstract, static) */
export type ClassMemberClassifier = 'abstract' | 'static';

/**
 * A class member (attribute or method)
 */
export interface ClassMember {
  /** Member name */
  name: string;
  /** Type (return type for methods, type for attributes) */
  type?: string;
  /** Visibility modifier */
  visibility?: ClassMemberVisibility;
  /** Classifier (abstract, static) */
  classifier?: ClassMemberClassifier;
  /** True if method (has parentheses), false for attribute */
  isMethod: boolean;
  /** Raw parameter string for methods */
  parameters?: string;
}

/** Class annotations */
export type ClassAnnotation = 'interface' | 'abstract' | 'service' | 'enumeration';

/**
 * A class in the diagram
 */
export interface ClassNode {
  /** Unique identifier */
  id: string;
  /** Display label (defaults to id) */
  label?: string;
  /** Class annotation (interface, abstract, etc.) */
  annotation?: ClassAnnotation;
  /** Class members (attributes and methods) */
  members: ClassMember[];
  /** Optional custom style */
  style?: Style;
}

/**
 * Relationship types between classes
 */
export type ClassRelationType =
  | 'inheritance'   // <|--
  | 'composition'   // *--
  | 'aggregation'   // o--
  | 'association'   // -->
  | 'dependency'    // ..>
  | 'realization'   // ..|>
  | 'link'          // --
  | 'linkDashed';   // ..

/**
 * A relationship between classes
 */
export interface ClassRelation {
  /** Source class ID */
  from: string;
  /** Target class ID */
  to: string;
  /** Relationship type */
  type: ClassRelationType;
  /** Optional label */
  label?: string;
  /** Cardinality at source end (e.g., "1", "0..*") */
  fromCardinality?: string;
  /** Cardinality at target end */
  toCardinality?: string;
}

/**
 * Complete class diagram definition
 */
export interface ClassDiagramDefinition {
  /** Diagram type marker */
  diagramType: 'class';
  /** Layout direction */
  direction?: GraphDirection;
  /** All classes in the diagram */
  classes: ClassNode[];
  /** All relationships between classes */
  relations: ClassRelation[];
}
