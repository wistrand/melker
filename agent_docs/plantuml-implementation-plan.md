# PlantUML Parser Implementation Plan

Add PlantUML support for class, sequence, and flowchart (activity) diagrams by creating new parsers that output to the existing neutral format types.

## Overview

### Target Diagram Types

| PlantUML Type | Parser Interface         | Output Type               |
|---------------|--------------------------|---------------------------|
| Sequence      | `SequenceDiagramParser`  | `SequenceDefinition`      |
| Class         | `ClassDiagramParser`     | `ClassDiagramDefinition`  |
| Activity      | `GraphParser`            | `GraphDefinition`         |

### Files to Create

```
src/components/graph/parsers/
├── plantuml-sequence.ts    # SequenceDiagramParser
├── plantuml-class.ts       # ClassDiagramParser
└── plantuml-flowchart.ts   # GraphParser (for activity diagrams)
```

### Files to Modify

- `src/components/graph/parsers/mod.ts` - Add registration and detection
- `src/components/graph/parsers/types.ts` - Extend `ParserType` union
- `src/components/graph/graph.ts` - Add `'plantuml'` to type prop
- `src/components/graph/graph-to-melker.ts` - Add `.puml` file support in CLI

---

## Phase 1: Infrastructure Setup

### 1.1 Extend Type Definitions

**File:** `src/components/graph/parsers/types.ts`

```typescript
export type ParserType =
  | 'json' | 'mermaid' | 'sequence' | 'class'
  | 'plantuml' | 'plantuml-sequence' | 'plantuml-class' | 'plantuml-flowchart';
```

### 1.2 Add Detection Functions

**File:** `src/components/graph/parsers/mod.ts`

```typescript
export function isPlantUML(content: string): boolean {
  return content.includes('@startuml');
}

export function detectPlantUMLType(content: string): 'sequence' | 'class' | 'flowchart' {
  // Sequence: has participant/actor declarations and message arrows
  if (/\b(participant|actor)\b/.test(content) && /->/.test(content)) {
    return 'sequence';
  }
  // Class: has class/interface/abstract/enum declarations
  if (/^\s*(class|interface|abstract\s+class|enum)\s+\w/m.test(content)) {
    return 'class';
  }
  // Default to flowchart (activity diagrams)
  return 'flowchart';
}
```

### 1.3 Update Parser Detection

**File:** `src/components/graph/parsers/mod.ts`

```typescript
export function detectParserType(content: string): ParserType {
  // Check PlantUML first
  if (isPlantUML(content)) {
    return `plantuml-${detectPlantUMLType(content)}` as ParserType;
  }
  // Existing Mermaid detection...
  if (isSequenceDiagram(content)) return 'sequence';
  if (isClassDiagram(content)) return 'class';
  return 'mermaid';
}
```

### 1.4 Add Factory Functions

**File:** `src/components/graph/parsers/mod.ts`

```typescript
import { PlantUMLSequenceParser } from './plantuml-sequence.ts';
import { PlantUMLClassParser } from './plantuml-class.ts';
import { PlantUMLFlowchartParser } from './plantuml-flowchart.ts';

export function getParser(type: ParserType): GraphParser | SequenceDiagramParser | ClassDiagramParser {
  switch (type) {
    case 'plantuml-sequence': return new PlantUMLSequenceParser();
    case 'plantuml-class': return new PlantUMLClassParser();
    case 'plantuml-flowchart': return new PlantUMLFlowchartParser();
    // existing cases...
  }
}
```

---

## Phase 2: Sequence Diagram Parser

**File:** `src/components/graph/parsers/plantuml-sequence.ts`

### 2.1 Syntax Mapping

| PlantUML Syntax            | Target Type           | Notes                 |
|----------------------------|-----------------------|-----------------------|
| `@startuml` / `@enduml`    | markers               | Strip from content    |
| `participant A`            | `SequenceParticipant` | type: `'participant'` |
| `actor A`                  | `SequenceParticipant` | type: `'actor'`       |
| `participant A as "Label"` | `SequenceParticipant` | with label            |
| `A -> B: message`          | `SequenceMessage`     | arrow: `'solid'`      |
| `A --> B: message`         | `SequenceMessage`     | arrow: `'dashed'`     |
| `A ->> B: message`         | `SequenceMessage`     | arrow: `'solid'` (thin) |
| `A ->o B: message`         | `SequenceMessage`     | arrow: `'solidOpen'`  |
| `A -->o B: message`        | `SequenceMessage`     | arrow: `'dashedOpen'` |
| `activate A`               | activation event      | `activate: true`      |
| `deactivate A`             | deactivation event    | `deactivate: true`    |
| `A -> B ++`                | message + activate    | shorthand             |
| `A -> B --`                | message + deactivate  | shorthand             |
| `note left of A: text`     | `SequenceNote`        | position: `'left'`    |
| `note right of A: text`    | `SequenceNote`        | position: `'right'`   |
| `note over A: text`        | `SequenceNote`        | position: `'over'`    |
| `note over A,B: text`      | `SequenceNote`        | multiple participants |
| `alt condition`            | `SequenceFragment`    | type: `'alt'`         |
| `else condition`           | fragment section      | new section           |
| `end`                      | close fragment        |                       |
| `loop condition`           | `SequenceFragment`    | type: `'loop'`        |
| `opt condition`            | `SequenceFragment`    | type: `'opt'`         |
| `par`                      | `SequenceFragment`    | type: `'par'`         |
| `break condition`          | `SequenceFragment`    | type: `'break'`       |
| `critical`                 | `SequenceFragment`    | type: `'critical'`    |
| `ref over A,B: text`       | `SequenceNote`        | map to note           |
| `== separator ==`          | divider               | map to note or ignore |
| `... delay ...`            | delay                 | map to note or ignore |

### 2.2 Parser Structure

```typescript
export class PlantUMLSequenceParser implements SequenceDiagramParser {
  parse(input: string): SequenceDefinition {
    const lines = this._preprocessLines(input);
    const participants: SequenceParticipant[] = [];
    const events: SequenceEvent[] = [];

    for (const line of lines) {
      if (this._isParticipant(line)) {
        participants.push(this._parseParticipant(line));
      } else if (this._isMessage(line)) {
        events.push(this._parseMessage(line));
      } else if (this._isNote(line)) {
        events.push(this._parseNote(line));
      } else if (this._isFragment(line)) {
        events.push(this._parseFragment(line, lines));
      }
      // ... activation, deactivation, etc.
    }

    return { diagramType: 'sequence', participants, events };
  }
}
```

### 2.3 Test Cases

- Basic message flow with different arrow types
- Participant declaration with aliases
- Activation/deactivation (explicit and shorthand)
- Notes in various positions
- Fragments: alt/else, loop, opt, par, break, critical
- Nested fragments
- Auto-participant creation from messages

---

## Phase 3: Class Diagram Parser

**File:** `src/components/graph/parsers/plantuml-class.ts`

### 3.1 Syntax Mapping

| PlantUML Syntax           | Target Type     | Notes                           |
|---------------------------|-----------------|---------------------------------|
| `@startuml` / `@enduml`   | markers         | Strip from content              |
| `class Foo`               | `ClassNode`     |                                 |
| `class Foo { }`           | `ClassNode`     | with body                       |
| `interface Foo`           | `ClassNode`     | annotation: `'interface'`       |
| `abstract class Foo`      | `ClassNode`     | annotation: `'abstract'`        |
| `enum Foo`                | `ClassNode`     | annotation: `'enumeration'`     |
| `class Foo <<stereotype>>`| `ClassNode`     | custom annotation               |
| `+field: Type`            | `ClassMember`   | visibility: `'public'`          |
| `-field: Type`            | `ClassMember`   | visibility: `'private'`         |
| `#field: Type`            | `ClassMember`   | visibility: `'protected'`       |
| `~field: Type`            | `ClassMember`   | visibility: `'package'`         |
| `{static} field`          | `ClassMember`   | classifier: `'static'`          |
| `{abstract} method()`     | `ClassMember`   | classifier: `'abstract'`        |
| `method()`                | `ClassMember`   | isMethod: `true`                |
| `method(): ReturnType`    | `ClassMember`   | with return type                |
| `method(params)`          | `ClassMember`   | with parameters                 |
| `A <\|-- B`               | `ClassRelation` | type: `'inheritance'`           |
| `A <\|.. B`               | `ClassRelation` | type: `'realization'`           |
| `A *-- B`                 | `ClassRelation` | type: `'composition'`           |
| `A o-- B`                 | `ClassRelation` | type: `'aggregation'`           |
| `A --> B`                 | `ClassRelation` | type: `'association'`           |
| `A ..> B`                 | `ClassRelation` | type: `'dependency'`            |
| `A -- B`                  | `ClassRelation` | type: `'link'`                  |
| `A .. B`                  | `ClassRelation` | type: `'linkDashed'`            |
| `"1" A -- "many" B`       | `ClassRelation` | with cardinality                |
| `A -- B : label`          | `ClassRelation` | with label                      |
| `Foo<T>`                  | `ClassNode`     | generic (convert `<>` to label) |

### 3.2 Parser Structure

```typescript
export class PlantUMLClassParser implements ClassDiagramParser {
  parse(input: string): ClassDiagramDefinition {
    const lines = this._preprocessLines(input);
    const classes: ClassNode[] = [];
    const relations: ClassRelation[] = [];
    let direction: GraphDirection = 'TB';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (this._isDirection(line)) {
        direction = this._parseDirection(line);
      } else if (this._isClassDeclaration(line)) {
        const classNode = this._parseClass(line, lines, i);
        classes.push(classNode);
        // Skip body lines if present
      } else if (this._isRelation(line)) {
        relations.push(this._parseRelation(line));
      }
    }

    return { diagramType: 'class', direction, classes, relations };
  }
}
```

### 3.3 Test Cases

- Class with fields and methods
- Interface, abstract class, enum declarations
- All visibility modifiers
- Static and abstract members
- All relationship types
- Relationships with cardinality and labels
- Generics
- Stereotypes/annotations

---

## Phase 4: Activity/Flowchart Parser

**File:** `src/components/graph/parsers/plantuml-flowchart.ts`

### 4.1 Syntax Mapping

| PlantUML Syntax             | Target Node/Edge | Notes                             |
|-----------------------------|------------------|-----------------------------------|
| `@startuml` / `@enduml`     | markers          | Strip from content                |
| `start`                     | `GraphNode`      | shape: `'circle'`, label: `'Start'` |
| `stop` / `end`              | `GraphNode`      | shape: `'circle'`, label: `'End'` |
| `:activity;`                | `GraphNode`      | shape: `'rect'`                   |
| `:activity]`                | `GraphNode`      | shape: `'rounded'` (note shape)   |
| `if (cond?) then (yes)`     | `GraphNode`      | shape: `'diamond'`                |
| `else (no)`                 | `GraphEdge`      | edge to else branch               |
| `elseif (cond?) then (yes)` | `GraphNode`      | additional diamond                |
| `endif`                     | merge point      | synthetic node                    |
| `while (cond?)`             | `GraphNode`      | shape: `'diamond'`                |
| `endwhile (label)`          | `GraphEdge`      | back edge with label              |
| `repeat`                    | loop start       | synthetic node                    |
| `repeat while (cond?)`      | `GraphNode`      | shape: `'diamond'`                |
| `backward :activity;`       | `GraphNode`      | on back edge                      |
| `fork`                      | `GraphNode`      | fork bar                          |
| `fork again`                | parallel branch  |                                   |
| `end fork`                  | `GraphNode`      | join bar                          |
| `\|Swimlane\|`              | `GraphSubgraph`  | partition                         |
| `partition Name { }`        | `GraphSubgraph`  | explicit partition                |
| `#color:activity;`          | `GraphNode`      | with style.background             |
| `->`                        | `GraphEdge`      | explicit arrow                    |
| `-[#color]->`               | `GraphEdge`      | with style                        |
| `detach`                    | terminate branch | no outgoing edge                  |

### 4.2 Key Challenge: Control Flow to Graph Conversion

PlantUML uses imperative control flow while `GraphDefinition` expects explicit nodes/edges.

**Strategy:**
1. Generate synthetic node IDs: `node_1`, `node_2`, etc.
2. Maintain a stack for control flow nesting
3. Track "current node" for implicit sequential flow
4. Convert control structures to explicit edges:

```
PlantUML:               GraphDefinition:
:A;                     node_1[A] --> node_2
if (cond?) then (yes)   node_2{cond?} -->|yes| node_3
  :B;                   node_3[B] --> node_5
else (no)               node_2{cond?} -->|no| node_4
  :C;                   node_4[C] --> node_5
endif                   node_5 (merge point, may be implicit)
:D;                     node_5 --> node_6[D]
```

### 4.3 Parser Structure

```typescript
interface ControlFlowContext {
  type: 'if' | 'while' | 'repeat' | 'fork';
  entryNode: string;
  exitNode?: string;
  branches: string[];  // current branch endpoints
}

export class PlantUMLFlowchartParser implements GraphParser {
  private nodeCounter = 0;
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private subgraphs: GraphSubgraph[] = [];
  private currentNode: string | null = null;
  private controlStack: ControlFlowContext[] = [];

  parse(input: string): GraphDefinition {
    const lines = this._preprocessLines(input);

    for (const line of lines) {
      if (this._isStart(line)) this._handleStart();
      else if (this._isStop(line)) this._handleStop();
      else if (this._isActivity(line)) this._handleActivity(line);
      else if (this._isIf(line)) this._handleIf(line);
      else if (this._isElse(line)) this._handleElse(line);
      else if (this._isEndif(line)) this._handleEndif();
      else if (this._isWhile(line)) this._handleWhile(line);
      else if (this._isEndwhile(line)) this._handleEndwhile(line);
      else if (this._isFork(line)) this._handleFork();
      else if (this._isForkAgain(line)) this._handleForkAgain();
      else if (this._isEndFork(line)) this._handleEndFork();
      else if (this._isSwimlane(line)) this._handleSwimlane(line);
    }

    return {
      direction: 'TB',
      nodes: this.nodes,
      edges: this.edges,
      subgraphs: this.subgraphs,
    };
  }

  private _createNode(label: string, shape: NodeShape): string {
    const id = `node_${++this.nodeCounter}`;
    this.nodes.push({ id, label, shape });
    return id;
  }

  private _connectToCurrent(nodeId: string, label?: string): void {
    if (this.currentNode) {
      this.edges.push({ from: this.currentNode, to: nodeId, label });
    }
    this.currentNode = nodeId;
  }
}
```

### 4.4 Test Cases

- Simple sequential activities
- If/else/elseif/endif branching
- While loops with back edges
- Repeat loops with backward activities
- Nested control structures
- Fork/join parallel activities
- Swimlanes and partitions
- Start/stop markers
- Colored activities
- Detach/kill terminators

---

## Phase 5: Integration and Testing

### 5.1 Update Graph Component (`<graph type="plantuml">`)

**File:** `src/components/graph/graph.ts`

The `<graph>` component must accept `type="plantuml"` and auto-detect the specific diagram subtype.

```typescript
interface GraphProps {
  type?: 'mermaid' | 'json' | 'plantuml';  // Add 'plantuml'
  // ...
}
```

**Auto-detection behavior**: When `type="plantuml"` is specified, the content is passed to `detectParserType()` which returns the specific PlantUML subtype (`plantuml-sequence`, `plantuml-class`, or `plantuml-flowchart`).

```xml
<!-- Example: PlantUML sequence diagram in a .melker file -->
<graph type="plantuml">
@startuml
Alice -> Bob: Hello
Bob --> Alice: Hi
@enduml
</graph>

<!-- Auto-detection picks plantuml-sequence based on content -->
```

### 5.2 Update graph-to-melker.ts CLI (`.puml` file support)

**File:** `src/components/graph/graph-to-melker.ts`

Add `.puml` file extension support matching existing `.mmd` handling.

**Changes required:**

1. **File type detection** (around line 1014-1019):
```typescript
// Current:
if (inputFile.endsWith('.json')) {
  type = 'json';
} else {
  type = detectParserType(content);
}

// Updated:
if (inputFile.endsWith('.json')) {
  type = 'json';
} else if (inputFile.endsWith('.puml') || inputFile.endsWith('.plantuml')) {
  // PlantUML file - auto-detect subtype
  type = detectParserType(content);  // Returns plantuml-sequence, plantuml-class, or plantuml-flowchart
} else {
  type = detectParserType(content);  // Works for both .mmd and .puml content
}
```

2. **ParserType mapping** (around line 1027-1032):
```typescript
const typeNames: Record<ParserType, string> = {
  sequence: 'Sequence',
  class: 'Class Diagram',
  mermaid: 'Graph',
  json: 'Graph',
  // Add PlantUML types:
  'plantuml-sequence': 'PlantUML Sequence',
  'plantuml-class': 'PlantUML Class Diagram',
  'plantuml-flowchart': 'PlantUML Activity',
};
```

3. **Usage documentation** (around line 1123-1138):
```typescript
console.log('Supported diagram types (auto-detected from content):');
console.log('  - Mermaid flowcharts: flowchart TB, graph LR, etc.');
console.log('  - Mermaid sequence diagrams: sequenceDiagram');
console.log('  - Mermaid class diagrams: classDiagram');
console.log('  - PlantUML diagrams: @startuml/@enduml (.puml files)');
console.log('  - JSON graph definitions (.json extension)');
// ...
console.log('Examples:');
console.log('  deno run --allow-read graph-to-melker.ts flowchart.mmd');
console.log('  deno run --allow-read graph-to-melker.ts sequence.puml');
console.log('  deno run --allow-read graph-to-melker.ts classdiagram.puml');
```

**CLI usage after implementation:**

```bash
# PlantUML files (new)
deno run --allow-read graph-to-melker.ts sequence.puml
deno run --allow-read --allow-write graph-to-melker.ts activity.puml output.melker
deno run --allow-read --allow-write graph-to-melker.ts --inputs diagrams/*.puml

# Mermaid files (existing)
deno run --allow-read graph-to-melker.ts flowchart.mmd
```

### 5.3 Update graphToMelker() Routing

Ensure `graphToMelker()` correctly routes PlantUML types to appropriate converters:

```typescript
export function graphToMelker(content: string, options: GraphToMelkerOptions): string {
  const { type: explicitType, name = 'Graph Output', container } = options;

  // Auto-detect diagram type (works for both Mermaid and PlantUML)
  const type = (explicitType === 'mermaid' || explicitType === 'plantuml')
    ? detectParserType(content)
    : explicitType;

  // Handle sequence diagrams (both Mermaid and PlantUML)
  if (type === 'sequence' || type === 'plantuml-sequence') {
    return sequenceToMelker(content, { name, container: containerOpts });
  }

  // Handle class diagrams (both Mermaid and PlantUML)
  if (type === 'class' || type === 'plantuml-class') {
    return classToMelker(content, { name, container: containerOpts });
  }

  // Handle flowcharts/activity diagrams
  if (type === 'plantuml-flowchart') {
    return activityToMelker(content, { name, container: containerOpts });
  }

  // Default: Mermaid flowchart or JSON graph
  const parser = getGraphParser(type as 'json' | 'mermaid');
  // ...
}
```

### 5.4 Create Test Files

```
tests/plantuml/
├── sequence_basic.puml        # Raw PlantUML source files
├── sequence_fragments.puml
├── class_basic.puml
├── class_relations.puml
├── activity_basic.puml
├── activity_control_flow.puml
├── activity_swimlanes.puml
├── sequence_basic.melker      # Generated .melker files (via graph-to-melker.ts --inputs)
├── sequence_fragments.melker
├── class_basic.melker
├── class_relations.melker
├── activity_basic.melker
├── activity_control_flow.melker
└── activity_swimlanes.melker
```

### 5.5 Add Examples

```
examples/melker/
├── plantuml-sequence.melker   # Using <graph type="plantuml">
├── plantuml-class.melker
└── plantuml-activity.melker
```

Example `.melker` file using embedded PlantUML:

```xml
<melker>
  <title>PlantUML Sequence Example</title>
  <graph type="plantuml" style="width: fill; height: fill">
@startuml
participant Alice
participant Bob

Alice -> Bob: Request
Bob --> Alice: Response
@enduml
  </graph>
</melker>
```

### 5.6 Update Documentation

- `agent_docs/mermaid-support.md` → rename to `diagram-support.md`
- Add PlantUML section with syntax examples
- Update component-reference.md graph component docs
- Update getting-started.md CLI examples to show `.puml` file support

---

## Complexity and Effort Estimate

| Phase                     | Effort | Risk   |
|---------------------------|--------|--------|
| Phase 1: Infrastructure   | Low    | Low    |
| Phase 2: Sequence Parser  | Medium | Low    |
| Phase 3: Class Parser     | Medium | Low    |
| Phase 4: Flowchart Parser | High   | Medium |
| Phase 5: Integration      | Medium | Low    |

**Total estimated effort:** Medium-High

**Highest risk:** Phase 4 (flowchart) due to control flow → graph conversion complexity.

---

## References

- [PlantUML Sequence Diagram](https://plantuml.com/sequence-diagram)
- [PlantUML Class Diagram](https://plantuml.com/class-diagram)
- [PlantUML Activity Diagram (Beta)](https://plantuml.com/activity-diagram-beta)
- [PlantUML Language Reference Guide](https://pdf.plantuml.net/PlantUML_Language_Reference_Guide_en.pdf)
