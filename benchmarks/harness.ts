/**
 * Benchmark harness utilities for Melker
 *
 * Usage:
 *   import { bench, BenchmarkSuite } from './harness.ts';
 *
 *   const suite = new BenchmarkSuite('rendering');
 *   suite.add('buffer-diff', () => buffer.diff(previous));
 *   suite.add('ansi-output', () => buffer.toAnsi());
 *   const results = await suite.run();
 *   await suite.saveResults('results/rendering.json');
 */

export interface BenchmarkResult {
  name: string;
  category: string;
  iterations: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  mean: number;
  unit: string;
  /** Target time in ms - benchmark passes if median <= target */
  target?: number;
}

/**
 * A key finding from benchmark analysis
 */
export interface BenchmarkFinding {
  /** Short title for the finding */
  title: string;
  /** Detailed description or explanation */
  description: string;
  /** Category: performance, comparison, regression, improvement, recommendation */
  category?: 'performance' | 'comparison' | 'regression' | 'improvement' | 'recommendation' | 'info';
  /** Related benchmark names */
  benchmarks?: string[];
  /** Severity/importance: info, warning, critical */
  severity?: 'info' | 'warning' | 'critical';
  /** Numeric values relevant to the finding */
  metrics?: Record<string, number | string>;
}

export interface BenchmarkOutput {
  timestamp: string;
  commit: string;
  results: BenchmarkResult[];
  /** Key findings and analysis from the benchmark run */
  findings?: BenchmarkFinding[];
  /** Free-form notes or summary */
  notes?: string;
}

/**
 * Run a single benchmark and return statistics
 */
export async function bench(
  name: string,
  fn: () => void | Promise<void>,
  options: {
    iterations?: number;
    warmup?: number;
    category?: string;
    target?: number;
  } = {},
): Promise<BenchmarkResult> {
  const iterations = options.iterations ?? 1000;
  const warmup = options.warmup ?? 100;
  const category = options.category ?? 'uncategorized';
  const target = options.target;

  // Warmup
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  // Measure
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  // Calculate statistics
  times.sort((a, b) => a - b);

  const sum = times.reduce((a, b) => a + b, 0);
  const mean = sum / times.length;
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const min = times[0];
  const max = times[times.length - 1];

  const result: BenchmarkResult = {
    name,
    category,
    iterations,
    median,
    p95,
    p99,
    min,
    max,
    mean,
    unit: 'ms',
  };

  if (target !== undefined) {
    result.target = target;
  }

  return result;
}

/**
 * Benchmark suite for organizing related benchmarks
 */
export class BenchmarkSuite {
  private benchmarks: Array<{ name: string; fn: () => void | Promise<void>; options?: { iterations?: number; warmup?: number; target?: number } }> = [];
  private results: BenchmarkResult[] = [];
  private findings: BenchmarkFinding[] = [];
  private notes: string | undefined;

  constructor(public category: string) {}

  /**
   * Add a benchmark to the suite
   * @param options.target - Target time in ms. Benchmark passes if median <= target.
   */
  add(name: string, fn: () => void | Promise<void>, options?: { iterations?: number; warmup?: number; target?: number }): this {
    this.benchmarks.push({ name, fn, options });
    return this;
  }

  /**
   * Run all benchmarks in the suite
   */
  async run(options: { log?: boolean } = {}): Promise<BenchmarkResult[]> {
    const log = options.log ?? true;

    this.results = [];

    for (const { name, fn, options: benchOptions } of this.benchmarks) {
      if (log) {
        console.log(`Running: ${name}...`);
      }

      const result = await bench(name, fn, {
        ...benchOptions,
        category: this.category,
      });

      this.results.push(result);

      if (log) {
        let status = '';
        if (result.target !== undefined) {
          status = result.median <= result.target ? ' [PASS]' : ' [FAIL]';
        }
        console.log(`  median: ${result.median.toFixed(3)}ms, p95: ${result.p95.toFixed(3)}ms, p99: ${result.p99.toFixed(3)}ms${status}`);
      }
    }

    return this.results;
  }

  /**
   * Add a key finding from benchmark analysis
   */
  addFinding(finding: BenchmarkFinding): this {
    this.findings.push(finding);
    return this;
  }

  /**
   * Add multiple findings at once
   */
  addFindings(findings: BenchmarkFinding[]): this {
    this.findings.push(...findings);
    return this;
  }

  /**
   * Set notes/summary for the benchmark run
   */
  setNotes(notes: string): this {
    this.notes = notes;
    return this;
  }

  /**
   * Get current findings
   */
  getFindings(): BenchmarkFinding[] {
    return this.findings;
  }

  /**
   * Get results as output format
   */
  toOutput(commit?: string): BenchmarkOutput {
    const output: BenchmarkOutput = {
      timestamp: new Date().toISOString(),
      commit: commit ?? this.getGitCommit(),
      results: this.results,
    };

    if (this.findings.length > 0) {
      output.findings = this.findings;
    }

    if (this.notes) {
      output.notes = this.notes;
    }

    return output;
  }

  /**
   * Save results to JSON file
   */
  async saveResults(path: string, commit?: string): Promise<void> {
    const output = this.toOutput(commit);
    await Deno.writeTextFile(path, JSON.stringify(output, null, 2));
  }

  /**
   * Get current git commit hash
   */
  private getGitCommit(): string {
    try {
      const cmd = new Deno.Command('git', {
        args: ['rev-parse', '--short', 'HEAD'],
        stdout: 'piped',
      });
      const output = cmd.outputSync();
      return new TextDecoder().decode(output.stdout).trim();
    } catch {
      return 'unknown';
    }
  }
}

/**
 * Generate a timestamp string for benchmark result filenames.
 * Format: YYYY-MM-DDTHH-MM (e.g., 2026-02-06T17-03)
 * Uses '-' for time separator since ':' is problematic in filenames.
 */
export function benchmarkTimestamp(): string {
  return new Date().toISOString().slice(0, 16).replace(':', '-');
}

/**
 * Compare two benchmark results
 */
export function compare(
  baseline: BenchmarkResult[],
  current: BenchmarkResult[],
): Array<{
  name: string;
  baseline: number;
  current: number;
  diff: number;
  diffPercent: number;
  status: 'faster' | 'slower' | 'same';
}> {
  const results = [];

  for (const curr of current) {
    const base = baseline.find((b) => b.name === curr.name);
    if (!base) continue;

    const diff = curr.median - base.median;
    const diffPercent = (diff / base.median) * 100;

    let status: 'faster' | 'slower' | 'same';
    if (diffPercent < -5) status = 'faster';
    else if (diffPercent > 5) status = 'slower';
    else status = 'same';

    results.push({
      name: curr.name,
      baseline: base.median,
      current: curr.median,
      diff,
      diffPercent,
      status,
    });
  }

  return results;
}

/**
 * Print comparison table
 */
export function printComparison(
  comparison: ReturnType<typeof compare>,
): void {
  console.log('\nBenchmark Comparison:');
  console.log('─'.repeat(70));
  console.log(
    'Name'.padEnd(25) +
    'Baseline'.padStart(12) +
    'Current'.padStart(12) +
    'Diff'.padStart(12) +
    'Status'.padStart(10)
  );
  console.log('─'.repeat(70));

  for (const row of comparison) {
    const diffStr = row.diff >= 0 ? `+${row.diffPercent.toFixed(1)}%` : `${row.diffPercent.toFixed(1)}%`;
    console.log(
      row.name.padEnd(25) +
      `${row.baseline.toFixed(2)}ms`.padStart(12) +
      `${row.current.toFixed(2)}ms`.padStart(12) +
      diffStr.padStart(12) +
      row.status.padStart(10)
    );
  }

  console.log('─'.repeat(70));
}
