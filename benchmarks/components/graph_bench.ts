/**
 * Graph component and Mermaid parsing benchmarks
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import { createElement, globalLayoutEngine, RenderingEngine } from '../../mod.ts';
import { DualBuffer } from '../../src/buffer.ts';
import {
  getGraphParser,
  getSequenceParser,
  getClassDiagramParser,
  calculateLayout,
} from '../../src/components/graph/mod.ts';
import { graphToMelker } from '../../src/components/graph/graph-to-melker.ts';

const suite = new BenchmarkSuite('graph');

const viewport = { width: 120, height: 60 };
const renderer = new RenderingEngine();

function makeContext(width: number, height: number) {
  return {
    viewport: { x: 0, y: 0, width, height },
    parentBounds: { x: 0, y: 0, width, height },
    availableSpace: { width, height },
  };
}

// =============================================================================
// Sample Mermaid diagrams for benchmarking
// =============================================================================

const simpleFlowchart = `flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E`;

const mediumFlowchart = `flowchart TD
    A[Start] --> B{Check Input}
    B -->|Valid| C[Process Data]
    B -->|Invalid| D[Show Error]
    C --> E{More Items?}
    E -->|Yes| F[Get Next Item]
    F --> C
    E -->|No| G[Generate Report]
    D --> H[Log Error]
    H --> I[Retry?]
    I -->|Yes| A
    I -->|No| J[Exit]
    G --> K[Save Results]
    K --> L[Send Notification]
    L --> M[Cleanup]
    M --> N[End]
    J --> N`;

const complexFlowchart = `flowchart TD
    subgraph Input
        A[User Request] --> B{Authenticate}
        B -->|Success| C[Parse Request]
        B -->|Fail| D[Return 401]
    end

    subgraph Processing
        C --> E{Validate}
        E -->|Valid| F[Process]
        E -->|Invalid| G[Return 400]
        F --> H{Cache Hit?}
        H -->|Yes| I[Return Cached]
        H -->|No| J[Query Database]
        J --> K[Transform Data]
        K --> L[Update Cache]
        L --> M[Build Response]
    end

    subgraph Output
        I --> N[Send Response]
        M --> N
        G --> N
        D --> N
        N --> O[Log Request]
        O --> P[Update Metrics]
        P --> Q[End]
    end`;

const simpleSequence = `sequenceDiagram
    participant User
    participant Server
    User->>Server: Request
    Server-->>User: Response`;

const mediumSequence = `sequenceDiagram
    participant Browser
    participant Server
    participant Database
    participant Cache

    Browser->>Server: GET /api/data
    Server->>Cache: Check cache
    alt Cache hit
        Cache-->>Server: Cached data
        Server-->>Browser: 200 OK (cached)
    else Cache miss
        Server->>Database: Query data
        Database-->>Server: Result set
        Server->>Cache: Store in cache
        Server-->>Browser: 200 OK (fresh)
    end`;

const complexSequence = `sequenceDiagram
    participant User
    participant Gateway
    participant Auth
    participant API
    participant Queue
    participant Worker
    participant DB
    participant Cache

    User->>Gateway: Request with token
    Gateway->>Auth: Validate token
    Auth-->>Gateway: Token valid
    Gateway->>API: Forward request
    API->>Cache: Check cache
    alt Cached
        Cache-->>API: Return cached
    else Not cached
        API->>DB: Query data
        DB-->>API: Results
        API->>Cache: Update cache
    end
    API->>Queue: Publish event
    Queue->>Worker: Process async
    Worker->>DB: Update stats
    API-->>Gateway: Response
    Gateway-->>User: Final response

    Note over User,Gateway: All requests are logged
    Note over Worker,DB: Async processing`;

const simpleClass = `classDiagram
    class Animal {
        +String name
        +makeSound()
    }
    class Dog {
        +bark()
    }
    Animal <|-- Dog`;

const mediumClass = `classDiagram
    class Vehicle {
        <<abstract>>
        +String brand
        +start()
        +stop()
    }
    class Car {
        +int doors
        +drive()
    }
    class Motorcycle {
        +boolean hasSidecar
        +wheelie()
    }
    class Engine {
        +int horsepower
        +String type
        +rev()
    }
    Vehicle <|-- Car
    Vehicle <|-- Motorcycle
    Car *-- Engine
    Motorcycle *-- Engine`;

const complexClass = `classDiagram
    class Application {
        <<interface>>
        +start()
        +stop()
        +getStatus() Status
    }
    class WebServer {
        -int port
        -Config config
        +start()
        +stop()
        +handleRequest(Request) Response
    }
    class Router {
        -routes: Map~String, Handler~
        +addRoute(String, Handler)
        +match(String) Handler
    }
    class Handler {
        <<interface>>
        +handle(Request) Response
    }
    class Middleware {
        <<abstract>>
        #next: Handler
        +handle(Request) Response
        #process(Request) Request
    }
    class AuthMiddleware {
        -authService: AuthService
        #process(Request) Request
    }
    class LoggingMiddleware {
        -logger: Logger
        #process(Request) Request
    }
    class Controller {
        #service: Service
        +handle(Request) Response
    }
    class Service {
        <<interface>>
        +execute(Command) Result
    }
    class Repository {
        <<interface>>
        +find(id) Entity
        +save(Entity)
        +delete(id)
    }

    Application <|.. WebServer
    WebServer --> Router
    WebServer --> Middleware
    Handler <|.. Middleware
    Handler <|.. Controller
    Middleware <|-- AuthMiddleware
    Middleware <|-- LoggingMiddleware
    Controller --> Service
    Service --> Repository`;

// =============================================================================
// Flowchart Parsing Benchmarks
// =============================================================================

const flowchartParser = getGraphParser('mermaid');

suite.add('parse-flowchart-simple', () => {
  flowchartParser.parse(simpleFlowchart);
}, { iterations: 1000, target: 0.1 });

suite.add('parse-flowchart-medium', () => {
  flowchartParser.parse(mediumFlowchart);
}, { iterations: 500, target: 0.2 });

suite.add('parse-flowchart-complex', () => {
  flowchartParser.parse(complexFlowchart);
}, { iterations: 200, target: 0.5 });

// =============================================================================
// Sequence Diagram Parsing Benchmarks
// =============================================================================

const sequenceParser = getSequenceParser();

suite.add('parse-sequence-simple', () => {
  sequenceParser.parse(simpleSequence);
}, { iterations: 1000, target: 0.1 });

suite.add('parse-sequence-medium', () => {
  sequenceParser.parse(mediumSequence);
}, { iterations: 500, target: 0.2 });

suite.add('parse-sequence-complex', () => {
  sequenceParser.parse(complexSequence);
}, { iterations: 200, target: 0.5 });

// =============================================================================
// Class Diagram Parsing Benchmarks
// =============================================================================

const classParser = getClassDiagramParser();

suite.add('parse-class-simple', () => {
  classParser.parse(simpleClass);
}, { iterations: 1000, target: 0.1 });

suite.add('parse-class-medium', () => {
  classParser.parse(mediumClass);
}, { iterations: 500, target: 0.2 });

suite.add('parse-class-complex', () => {
  classParser.parse(complexClass);
}, { iterations: 200, target: 0.5 });

// =============================================================================
// Layout Calculation Benchmarks
// =============================================================================

const simpleGraph = flowchartParser.parse(simpleFlowchart);
const mediumGraph = flowchartParser.parse(mediumFlowchart);
const complexGraph = flowchartParser.parse(complexFlowchart);

suite.add('layout-simple', () => {
  calculateLayout(simpleGraph);
}, { iterations: 2000, target: 0.05 });

suite.add('layout-medium', () => {
  calculateLayout(mediumGraph);
}, { iterations: 1000, target: 0.1 });

suite.add('layout-complex', () => {
  calculateLayout(complexGraph);
}, { iterations: 500, target: 0.2 });

// =============================================================================
// Graph-to-Melker Conversion Benchmarks
// =============================================================================

suite.add('convert-flowchart-simple', () => {
  graphToMelker(simpleFlowchart, { type: 'mermaid' });
}, { iterations: 500, target: 0.3 });

suite.add('convert-flowchart-complex', () => {
  graphToMelker(complexFlowchart, { type: 'mermaid' });
}, { iterations: 200, target: 0.8 });

suite.add('convert-sequence-medium', () => {
  graphToMelker(mediumSequence, { type: 'mermaid' });
}, { iterations: 500, target: 0.5 });

suite.add('convert-class-medium', () => {
  graphToMelker(mediumClass, { type: 'mermaid' });
}, { iterations: 500, target: 0.3 });

// =============================================================================
// Full Graph Element Rendering Benchmarks
// =============================================================================

// Simple flowchart rendering
const simpleGraphEl = createElement('graph', { text: simpleFlowchart });
suite.add('render-flowchart-simple', () => {
  globalLayoutEngine.calculateLayout(simpleGraphEl, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(simpleGraphEl, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 100, target: 2.0 });

// Medium flowchart rendering
const mediumGraphEl = createElement('graph', { text: mediumFlowchart });
suite.add('render-flowchart-medium', () => {
  globalLayoutEngine.calculateLayout(mediumGraphEl, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(mediumGraphEl, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 50, target: 5.0 });

// Complex flowchart rendering
const complexGraphEl = createElement('graph', { text: complexFlowchart });
suite.add('render-flowchart-complex', () => {
  globalLayoutEngine.calculateLayout(complexGraphEl, makeContext(viewport.width, 80));
  const buffer = new DualBuffer(viewport.width, 80);
  renderer.render(complexGraphEl, buffer, { x: 0, y: 0, width: viewport.width, height: 80 });
}, { iterations: 20, target: 10.0 });

// Sequence diagram rendering
const sequenceGraphEl = createElement('graph', { text: mediumSequence });
suite.add('render-sequence-medium', () => {
  globalLayoutEngine.calculateLayout(sequenceGraphEl, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(sequenceGraphEl, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 50, target: 8.0 });

// Class diagram rendering
const classGraphEl = createElement('graph', { text: mediumClass });
suite.add('render-class-medium', () => {
  globalLayoutEngine.calculateLayout(classGraphEl, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(classGraphEl, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 50, target: 8.0 });

// Complex class diagram rendering
const complexClassEl = createElement('graph', { text: complexClass });
suite.add('render-class-complex', () => {
  globalLayoutEngine.calculateLayout(complexClassEl, makeContext(viewport.width, 100));
  const buffer = new DualBuffer(viewport.width, 100);
  renderer.render(complexClassEl, buffer, { x: 0, y: 0, width: viewport.width, height: 100 });
}, { iterations: 20, target: 15.0 });

// =============================================================================
// Run benchmarks
// =============================================================================

const results = await suite.run();

// Helper to get median from results
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

// Add findings
suite.addFindings([
  {
    title: 'Flowchart parsing is fastest',
    description: 'Flowchart parsing is faster than sequence and class diagrams due to simpler syntax.',
    category: 'info',
    benchmarks: ['parse-flowchart-medium', 'parse-sequence-medium', 'parse-class-medium'],
    metrics: {
      flowchartMs: getMedian('parse-flowchart-medium'),
      sequenceMs: getMedian('parse-sequence-medium'),
      classMs: getMedian('parse-class-medium'),
    }
  },
  {
    title: 'Layout is O(n*e) complexity',
    description: 'Layout calculation scales with nodes and edges. Complex graphs with subgraphs take longer.',
    category: 'info',
    benchmarks: ['layout-simple', 'layout-medium', 'layout-complex'],
    metrics: {
      simpleMs: getMedian('layout-simple'),
      mediumMs: getMedian('layout-medium'),
      complexMs: getMedian('layout-complex'),
    }
  },
  {
    title: 'Rendering dominates graph processing time',
    description: 'Full rendering (parse + layout + convert + render) is significantly slower than parsing alone.',
    category: 'info',
    benchmarks: ['parse-flowchart-simple', 'render-flowchart-simple'],
    metrics: {
      parseMs: getMedian('parse-flowchart-simple'),
      renderMs: getMedian('render-flowchart-simple'),
      ratio: `${(getMedian('render-flowchart-simple') / getMedian('parse-flowchart-simple')).toFixed(0)}x`,
    }
  }
]);

// Set notes
suite.setNotes('Graph component and Mermaid diagram benchmarks. Tests parsing (flowchart, sequence, class), layout calculation, conversion to Melker XML, and full rendering pipeline.');

// Save results
const outputPath = new URL('../results/graph-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
