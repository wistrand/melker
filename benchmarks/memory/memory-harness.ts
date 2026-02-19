/**
 * Memory benchmark harness for Melker
 *
 * Measures heap memory consumption in KB instead of execution time.
 * Produces the same BenchmarkOutput JSON format, so the existing
 * benchmark viewer works without modification.
 *
 * Requires: --v8-flags=--expose-gc
 *
 * Usage:
 *   const suite = new MemoryBenchmarkSuite('memory');
 *   suite.add('dual-buffer-80x24', () => new DualBuffer(80, 24));
 *   await suite.run();
 *   await suite.saveResults('results/memory.json');
 */

import type {
  BenchmarkResult,
  BenchmarkOutput,
  BenchmarkFinding,
} from '../harness.ts';
import { benchmarkTimestamp } from '../harness.ts';

export type { BenchmarkResult, BenchmarkOutput, BenchmarkFinding };
export { benchmarkTimestamp };

// V8's gc() is available when launched with --v8-flags=--expose-gc
declare function gc(): void;

interface MemoryBenchmark {
  name: string;
  fn: () => unknown;
  async?: boolean;
  options?: { iterations?: number; warmup?: number; target?: number };
}

/**
 * Benchmark suite that measures heap memory allocation in KB.
 *
 * Each benchmark function must return a reference to the allocated objects
 * so they are not garbage-collected before measurement.
 */
export class MemoryBenchmarkSuite {
  private benchmarks: MemoryBenchmark[] = [];
  private results: BenchmarkResult[] = [];
  private findings: BenchmarkFinding[] = [];
  private notes: string | undefined;

  constructor(public category: string) {
    // Verify gc() is available
    if (typeof gc !== 'function') {
      throw new Error(
        'gc() not available. Run with --v8-flags=--expose-gc'
      );
    }
  }

  /**
   * Add a memory benchmark.
   * fn must return a reference to the allocated objects to keep them alive.
   */
  add(
    name: string,
    fn: () => unknown,
    options?: { iterations?: number; warmup?: number; target?: number },
  ): this {
    this.benchmarks.push({ name, fn, options });
    return this;
  }

  /**
   * Add an async memory benchmark.
   * fn must return a reference to the allocated objects to keep them alive.
   */
  addAsync(
    name: string,
    fn: () => Promise<unknown>,
    options?: { iterations?: number; warmup?: number; target?: number },
  ): this {
    this.benchmarks.push({ name, fn, async: true, options });
    return this;
  }

  /**
   * Run all benchmarks and return results
   */
  async run(options: { log?: boolean } = {}): Promise<BenchmarkResult[]> {
    const log = options.log ?? true;
    this.results = [];

    for (const bench of this.benchmarks) {
      if (log) {
        console.log(`Running: ${bench.name}...`);
      }

      const result = bench.async
        ? await this.measureAsync(bench)
        : this.measure(bench);
      this.results.push(result);

      if (log) {
        let status = '';
        if (result.target !== undefined) {
          status = result.median <= result.target ? ' [PASS]' : ' [FAIL]';
        }
        console.log(
          `  median: ${result.median.toFixed(2)} KB  p95: ${result.p95.toFixed(2)} KB${status}`
        );
      }
    }

    return this.results;
  }

  /**
   * Measure a single benchmark's memory consumption
   */
  private measure(bench: MemoryBenchmark): BenchmarkResult {
    const iterations = bench.options?.iterations ?? 30;
    const warmup = bench.options?.warmup ?? 5;
    const target = bench.options?.target;

    // Warmup rounds — let V8 JIT optimize
    for (let i = 0; i < warmup; i++) {
      const holder = bench.fn();
      // Prevent dead-code elimination
      if (holder === Symbol.for('__never__')) throw 0;
    }

    const samples: number[] = [];

    for (let i = 0; i < iterations; i++) {
      // Clear previous allocations and stabilize heap
      gc();
      gc();
      const before = Deno.memoryUsage().heapUsed;

      // Allocate
      let holder: unknown = bench.fn();

      // Force GC of unreachable objects while keeping holder alive
      gc();
      const after = Deno.memoryUsage().heapUsed;

      samples.push((after - before) / 1024); // bytes → KB

      // Prevent holder from being optimized away
      if (holder === Symbol.for('__never__')) throw 0;
      holder = null;
    }

    // Calculate statistics
    samples.sort((a, b) => a - b);

    const sum = samples.reduce((a, b) => a + b, 0);
    const mean = sum / samples.length;
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const p99 = samples[Math.floor(samples.length * 0.99)];
    const min = samples[0];
    const max = samples[samples.length - 1];

    const result: BenchmarkResult = {
      name: bench.name,
      category: this.category,
      iterations,
      median,
      p95,
      p99,
      min,
      max,
      mean,
      unit: 'KB',
    };

    if (target !== undefined) {
      result.target = target;
    }

    return result;
  }

  /**
   * Measure a single async benchmark's memory consumption
   */
  private async measureAsync(bench: MemoryBenchmark): Promise<BenchmarkResult> {
    const iterations = bench.options?.iterations ?? 30;
    const warmup = bench.options?.warmup ?? 5;
    const target = bench.options?.target;

    // Warmup rounds
    for (let i = 0; i < warmup; i++) {
      const holder = await bench.fn();
      if (holder === Symbol.for('__never__')) throw 0;
    }

    const samples: number[] = [];

    for (let i = 0; i < iterations; i++) {
      gc();
      gc();
      const before = Deno.memoryUsage().heapUsed;

      let holder: unknown = await bench.fn();

      gc();
      const after = Deno.memoryUsage().heapUsed;

      samples.push((after - before) / 1024);

      if (holder === Symbol.for('__never__')) throw 0;
      holder = null;
    }

    samples.sort((a, b) => a - b);

    const sum = samples.reduce((a, b) => a + b, 0);
    const mean = sum / samples.length;
    const median = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.floor(samples.length * 0.95)];
    const p99 = samples[Math.floor(samples.length * 0.99)];
    const min = samples[0];
    const max = samples[samples.length - 1];

    const result: BenchmarkResult = {
      name: bench.name,
      category: this.category,
      iterations,
      median,
      p95,
      p99,
      min,
      max,
      mean,
      unit: 'KB',
    };

    if (target !== undefined) {
      result.target = target;
    }

    return result;
  }

  /** Add a key finding */
  addFinding(finding: BenchmarkFinding): this {
    this.findings.push(finding);
    return this;
  }

  /** Add multiple findings at once */
  addFindings(findings: BenchmarkFinding[]): this {
    this.findings.push(...findings);
    return this;
  }

  /** Set notes/summary for the benchmark run */
  setNotes(notes: string): this {
    this.notes = notes;
    return this;
  }

  /** Get current findings */
  getFindings(): BenchmarkFinding[] {
    return this.findings;
  }

  /** Get results as BenchmarkOutput */
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

  /** Save results to JSON file */
  async saveResults(path: string, commit?: string): Promise<void> {
    const output = this.toOutput(commit);
    await Deno.writeTextFile(path, JSON.stringify(output, null, 2));
  }

  /** Get current git commit hash */
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
