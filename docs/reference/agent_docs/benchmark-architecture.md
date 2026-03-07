# Melker Benchmark Architecture

## Summary

- 17 benchmark suites with 300+ individual benchmarks covering layout, rendering, parsing, and components
- Run all with `deno run benchmarks/run-all.ts`; results saved as JSON baseline for regression tracking
- Each suite runs warm-up iterations, measures median/p95/p99, and reports ops/sec

Benchmarking infrastructure for Melker subsystems and components. Currently includes **17 benchmark suites** with **300+ individual benchmarks**.

**Latest baseline:** [baseline.json](../benchmarks/results/baseline.json)

---

## Running Benchmarks

```bash
# Run all benchmarks (combines results into single JSON)
deno run --allow-read --allow-write --allow-run --allow-env benchmarks/run-all.ts

# Run individual benchmark suite
deno run --allow-read --allow-write --allow-run --allow-env benchmarks/core/geometry_bench.ts
```

Results are saved to `benchmarks/results/` as JSON files with the format `<suite>-<date>.json`. Only `baseline.json` is committed; all other result files are gitignored.

---

## Benchmark Viewer

View results using the benchmark-viewer app:

```bash
# View baseline results
./melker.ts benchmarks/benchmark-viewer.melker benchmarks/results/baseline.json

# View a specific run
./melker.ts benchmarks/benchmark-viewer.melker benchmarks/results/combined-2026-02-06.json
```

Features:
- Summary table with median/p95/p99, targets, pass/fail status
- Heatmap showing percentile distribution
- Key findings and notes display
- Filter by category
- Load JSON result files via file browser dialog

---

## Directory Structure

```
benchmarks/
  run-all.ts                   # Run all benchmarks, combine results
  harness.ts                   # BenchmarkSuite class and utilities
  benchmark-viewer.melker      # TUI results viewer
  core/                        # Foundational hot-path operations
    geometry_bench.ts          # pointInBounds, clipBounds, boundsIntersect
    hit_test_bench.ts          # Element detection at screen coordinates
    content_measurer_bench.ts  # Element sizing for layout calculations
    ansi_output_bench.ts       # Terminal escape sequence generation
    tree_traversal_bench.ts    # findElement, collectElements, isDescendant
  rendering/                   # Buffer and rendering pipeline
    buffer_bench.ts            # setCell, fillRect, clear, drawBorder
    buffer_diff_bench.ts       # Diff scenarios, dirty tracking, DualBuffer
    components_bench.ts        # Component rendering (30 component types)
  components/                  # Individual component benchmarks
    heatmap_bench.ts           # Data-heatmap with isolines
    markdown_bench.ts          # Markdown parsing and rendering
    graph_bench.ts             # Mermaid diagram parsing and rendering
  layout/                      # Layout engine
    layout_bench.ts            # Flat, nested, flex, grid layouts
  bundler/                     # .melker file processing
    bundler_bench.ts           # Parsing and code generation
  launcher/                    # App launching
    launcher_bench.ts          # Policy loading, validation, Deno flags
  graphics/                    # Image processing
    quantization_bench.ts      # Median-cut, fixed palette quantization
    encoding_bench.ts          # Sixel and Kitty encoding
    dithering_bench.ts         # Floyd-Steinberg, Sierra, Atkinson, etc.
  results/                     # Output directory (gitignored except baseline)
    baseline.json              # Committed baseline for regression tracking
    combined-*.json            # Combined results from run-all.ts (local only)
    <suite>-*.json             # Per-suite results (local only)
```

---

## Suite Overview

| Category   | Suite            | Tests | Description                              |
|------------|------------------|-------|------------------------------------------|
| core       | geometry         | 19    | Bounds checking, clipping, intersection  |
| core       | hit-test         | 21    | Element detection at screen coordinates  |
| core       | content-measurer | 21    | Element sizing for layout                |
| core       | ansi-output      | 20    | Terminal escape sequence generation      |
| core       | tree-traversal   | 36    | Element tree searching and filtering     |
| rendering  | buffer           | 7     | Basic buffer operations                  |
| rendering  | buffer-diff      | 22    | Buffer comparison and dirty tracking     |
| rendering  | components       | 30    | Component rendering pipeline             |
| components | heatmap          | 7     | Data-heatmap visualization               |
| components | markdown         | 15    | Markdown parsing and rendering           |
| components | graph            | 22    | Mermaid diagram processing               |
| layout     | layout           | 7     | Layout engine calculations               |
| bundler    | bundler          | 9     | .melker parsing and codegen              |
| launcher   | launcher         | 17    | Policy and permission handling           |
| graphics   | quantization     | 6     | Color quantization algorithms            |
| graphics   | encoding         | 6     | Sixel/Kitty image encoding               |
| graphics   | dithering        | 12    | Dithering algorithms                     |

---

## Result JSON Format

```json
{
  "timestamp": "2026-02-03T12:34:56Z",
  "commit": "abc1234",
  "results": [
    {
      "name": "buffer-diff",
      "category": "rendering",
      "iterations": 1000,
      "median": 0.05,
      "p95": 0.07,
      "p99": 0.09,
      "min": 0.03,
      "max": 0.15,
      "mean": 0.06,
      "unit": "ms",
      "target": 0.5
    }
  ],
  "findings": [
    {
      "title": "Finding title",
      "description": "Description of the finding",
      "category": "info",
      "benchmarks": ["benchmark-1", "benchmark-2"],
      "metrics": { "key": "value" }
    }
  ],
  "notes": "Suite-level notes about what was benchmarked."
}
```

---

## Harness API

```typescript
import { BenchmarkSuite } from '../harness.ts';

const suite = new BenchmarkSuite('category-name');

// Add benchmarks with targets for pass/fail
suite.add('benchmark-name', () => {
  // code to measure
}, { iterations: 1000, warmup: 100, target: 0.5 });

// Run all benchmarks
const results = await suite.run();

// Add findings (insights from benchmark results)
suite.addFindings([
  {
    title: 'Finding title',
    description: 'What this means',
    category: 'info',
    benchmarks: ['benchmark-1', 'benchmark-2'],
    metrics: { ratio: '2.5x' }
  }
]);

// Add notes
suite.setNotes('Description of what this suite benchmarks.');

// Save results
await suite.saveResults('results/category-name-2026-02-03.json');
```

---

## Adding New Benchmarks

1. Create `benchmarks/<category>/<name>_bench.ts`
2. Import harness: `import { BenchmarkSuite } from '../harness.ts';`
3. Create suite: `const suite = new BenchmarkSuite('category');`
4. Add benchmarks with targets: `suite.add('name', () => { ... }, { target: 0.5 });`
5. Add findings and notes for context
6. Run and save: `await suite.run(); await suite.saveResults(...);`
7. Add to `run-all.ts` benchmarkFiles array
8. Update this doc's Suite Overview table
