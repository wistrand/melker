# Graph Component Architecture

## Summary

- Renders flowcharts and diagrams from Mermaid syntax or JSON as native Melker elements
- Pipeline: parse → definition → level-based layout → flex containers + connectors → render
- Nodes are interactive (focusable, clickable); connectors draw edges with Unicode box-drawing

The graph component renders diagrams from Mermaid syntax or JSON input, converting them to native Melker elements.

## Overview

```
Input (Mermaid/JSON) → Parser → Definition → Layout → Melker XML → Render
```

The graph system uses a pipeline architecture:

1. **Parsers** convert text input to typed definitions
2. **Layout engine** calculates node positions by level
3. **Converter** generates Melker XML with flex containers and connectors
4. **GraphElement** parses XML and renders as subtree elements

---

## Supported Diagram Types

| Type             | Parser File            | Definition Type          |
|------------------|------------------------|--------------------------|
| Flowchart        | `mermaid-flowchart.ts` | `GraphDefinition`        |
| Sequence Diagram | `mermaid-sequence.ts`  | `SequenceDefinition`     |
| Class Diagram    | `mermaid-class.ts`     | `ClassDiagramDefinition` |
| JSON Graph       | `json.ts`              | `GraphDefinition`        |

---

## Type Definitions

All types are defined in `src/components/graph/types.ts`.

### GraphDefinition (Flowcharts)

```typescript
interface GraphDefinition {
  direction: GraphDirection;      // 'TB' | 'BT' | 'LR' | 'RL'
  nodes: GraphNode[];
  edges: GraphEdge[];
  subgraphs?: Subgraph[];
}

interface GraphNode {
  id: string;
  label: string;
  shape: NodeShape;               // 'rect' | 'diamond' | 'circle' | 'hexagon'
  style?: Style;
}

interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  arrow?: ArrowStyle;             // 'none' | 'arrow' | 'open'
  lineStyle?: LineStyle;          // 'solid' | 'dashed' | 'thick'
}
```

### SequenceDefinition

```typescript
interface SequenceDefinition {
  diagramType: 'sequence';
  participants: Participant[];
  events: SequenceEvent[];
}

interface Participant {
  id: string;
  label: string;
  type: 'participant' | 'actor';
}

type SequenceEvent =
  | { type: 'message'; message: Message }
  | { type: 'note'; note: Note }
  | { type: 'fragment'; fragment: Fragment };
```

### ClassDiagramDefinition

```typescript
interface ClassDiagramDefinition {
  diagramType: 'class';
  direction?: GraphDirection;
  classes: ClassNode[];
  relations: ClassRelation[];
}

interface ClassNode {
  id: string;
  annotation?: ClassAnnotation;   // 'interface' | 'abstract' | 'service' | 'enumeration'
  members: ClassMember[];
}

interface ClassMember {
  name: string;
  type?: string;
  visibility?: 'public' | 'private' | 'protected' | 'package';
  classifier?: 'abstract' | 'static';
  isMethod: boolean;
  parameters?: string;
}

interface ClassRelation {
  from: string;
  to: string;
  type: ClassRelationType;        // 'inheritance' | 'composition' | 'aggregation' | etc.
  label?: string;
  fromCardinality?: string;
  toCardinality?: string;
}
```

---

## Parser Architecture

Parsers implement typed interfaces from `parsers/types.ts`:

```typescript
interface GraphParser {
  parse(input: string): GraphDefinition;
}

interface SequenceDiagramParser {
  parse(input: string): SequenceDefinition;
}

interface ClassDiagramParser {
  parse(input: string): ClassDiagramDefinition;
}
```

### Parser Detection

The `detectParserType()` function auto-detects diagram type from content:

```typescript
function detectParserType(content: string): ParserType {
  if (isSequenceDiagram(content)) return 'sequence';
  if (isClassDiagram(content)) return 'class';
  return 'mermaid';  // Default to flowchart
}
```

### Mermaid Syntax Support

**Flowcharts:**
- Directions: `flowchart TB|BT|LR|RL`
- Node shapes: `[rect]`, `{diamond}`, `((circle))`, `{{hexagon}}`
- Edges: `-->`, `---`, `-.->`, `==>`, with labels `-->|label|`
- Subgraphs: `subgraph name ... end`

**Sequence Diagrams:**
- Participants: `participant A as Alias`, `actor U as User`
- Messages: `->>`, `-->>`, `-x`, `--x`
- Notes: `Note over A: text`, `Note right of A: text`
- Fragments: `alt`, `opt`, `loop`, `par`, `break`

**Class Diagrams:**
- Classes: `class Name`, `class Name { members }`
- Members: `+public`, `-private`, `#protected`, `~package`
- Methods: `name()`, `name(params)`, `name(): returnType`
- Types: `String`, `List~String~` (generics), `Element[]` (arrays)
- Relationships: `<|--`, `*--`, `o--`, `-->`, `..>`, `..|>`
- Annotations: `<<interface>>`, `<<abstract>>`

---

## Layout Engine

The layout engine (`layout.ts`) calculates node positions using level-based placement.

### Algorithm

1. **Build adjacency graph** from edges
2. **Topological sort** to determine levels
3. **Assign nodes to levels** based on dependencies
4. **Position nodes within levels** with even spacing

```typescript
function calculateLayout(graph: GraphDefinition): LayoutResult {
  // Returns nodes grouped by level with x,y positions
}
```

### Class Diagram Layout

For class diagrams, only **inheritance-type relationships** (inheritance, realization) determine the hierarchy. Other relationships (association, dependency, composition, aggregation) are rendered as connectors but don't affect level assignment. This prevents cyclic dependencies from collapsing all classes to a single level.

```typescript
// Only use inheritance edges for layout calculation
const hierarchyRelations = diagram.relations.filter(r =>
  r.type === 'inheritance' || r.type === 'realization'
);
```

Arrow directions follow UML conventions:
- **Inheritance/Realization**: Arrow points to superclass/interface (`arrow="start"`)
- **Association/Dependency**: Arrow points to the target (`arrow="end"`)

### Layout Result

```typescript
interface LayoutResult {
  levels: LayoutLevel[];
  width: number;
  height: number;
}

interface LayoutLevel {
  nodes: LayoutNode[];
  y: number;
}

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
```

---

## Melker Conversion

The converter (`graph-to-melker.ts`) transforms definitions to Melker XML.

### Output Structure

All diagrams generate:
1. **Style block** with CSS classes
2. **Container hierarchy** using flex layout
3. **Connector elements** for relationships

### Flowchart Output

```xml
<container class="graph-container graph-col">
  <!-- Level containers -->
  <container class="graph-level" style="flex-direction: row">
    <container id="node-A" class="graph-node graph-rect">
      <text>Node A</text>
    </container>
  </container>

  <!-- Connectors -->
  <connector from="node-A" to="node-B" arrow="end" />
</container>
```

### Sequence Diagram Output

```xml
<container class="sequence-container">
  <table class="sequence-table" border="none" cellPadding="9">
    <thead>
      <tr><th>User</th><th>Server</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><container id="msg-0-User" style="border-left: thin" /></td>
        <td><container id="msg-0-Server" style="border-left: thin" /></td>
      </tr>
    </tbody>
    <tfoot>
      <tr><td>User</td><td>Server</td></tr>
    </tfoot>
  </table>

  <connector from="msg-0-User" to="msg-0-Server" routing="horizontal" arrow="end" label="Request" />
</container>
```

### Class Diagram Output

```xml
<container class="class-diagram class-diagram-col">
  <container class="level" style="flex-direction: row; gap: 3">
    <container id="class-Animal" class="class-box">
      <text class="class-name">Animal</text>
      <text>+name: String</text>
      <text>+makeSound()</text>
    </container>
  </container>

  <connector from="class-Dog" to="class-Animal" arrow="end" />
</container>
```

---

## Connector Component

The `<connector>` component draws lines between elements by ID.

### Props

| Prop      | Type                                         | Description                       |
|-----------|----------------------------------------------|-----------------------------------|
| `from`    | string                                       | Source element ID                 |
| `to`      | string                                       | Target element ID                 |
| `routing` | `'direct'` \| `'horizontal'`                 | Line routing strategy             |
| `arrow`   | `'none'` \| `'start'` \| `'end'` \| `'both'` | Arrow placement                   |
| `label`   | string                                       | Text label on the line            |
| `style`   | Style                                        | Line style (`line-style: dashed`) |

### Rendering

Connectors render as overlay elements after the main layout pass:

1. Look up source/target bounds via `getElementBounds()`
2. Calculate line path based on routing
3. Draw line characters (`─`, `│`, `╌`, etc.)
4. Draw arrows (`▶`, `◀`, `▲`, `▼`)
5. Center label text on line

---

## GraphElement Component

The `GraphElement` class (`graph.ts`) orchestrates the pipeline.

### Lifecycle

1. **Content resolution**: `src` prop, `text` prop, or children text
2. **Parser detection**: Auto-detect or use `type` prop
3. **Parsing**: Convert input to typed definition
4. **Conversion**: Generate Melker XML via `graphToMelker()`
5. **Element creation**: Parse XML to element tree
6. **Caching**: Store elements for reuse

### Subtree Rendering

Graph elements are rendered as subtrees:
- Owned by the GraphElement, not the document
- Rendered via `renderElementSubtree()` helper
- Exposed via `HasSubtreeElements` interface (`getSubtreeElements()`) for focus/hit-testing — see [mermaid-support.md](mermaid-support.md#element-discovery)

---

## Files

| File                                               | Purpose                            |
|----------------------------------------------------|------------------------------------|
| `src/components/graph/graph.ts`                    | GraphElement component             |
| `src/components/graph/types.ts`                    | Type definitions                   |
| `src/components/graph/layout.ts`                   | Level-based layout algorithm       |
| `src/components/graph/graph-to-melker.ts`          | Definition to Melker XML converter |
| `src/components/graph/parsers/mod.ts`              | Parser registry and factory        |
| `src/components/graph/parsers/types.ts`            | Parser interfaces                  |
| `src/components/graph/parsers/mermaid-flowchart.ts` | Flowchart parser                  |
| `src/components/graph/parsers/mermaid-sequence.ts` | Sequence diagram parser            |
| `src/components/graph/parsers/mermaid-class.ts`    | Class diagram parser               |
| `src/components/graph/parsers/json.ts`             | JSON graph parser                  |
| `src/components/connector.ts`                      | Connector component                |
| `src/components/connector-utils.ts`                | Line drawing utilities             |

---

## See Also

- [mermaid-support.md](mermaid-support.md) — Usage guide for mermaid diagrams
- [component-reference.md](component-reference.md) — Full `<graph>` component documentation
