#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

/**
 * Run all benchmarks and combine results
 */

import { BenchmarkOutput, BenchmarkFinding } from './harness.ts';

const benchmarkFiles = [
  './core/geometry_bench.ts',
  './core/hit_test_bench.ts',
  './core/content_measurer_bench.ts',
  './core/ansi_output_bench.ts',
  './core/tree_traversal_bench.ts',
  './rendering/buffer_bench.ts',
  './rendering/buffer_diff_bench.ts',
  './rendering/components_bench.ts',
  './components/heatmap_bench.ts',
  './components/markdown_bench.ts',
  './components/graph_bench.ts',
  './layout/layout_bench.ts',
  './bundler/bundler_bench.ts',
  './launcher/launcher_bench.ts',
  './graphics/quantization_bench.ts',
  './graphics/encoding_bench.ts',
  './graphics/dithering_bench.ts',
];

console.log('Running all benchmarks...\n');
console.log('='.repeat(60));

const allResults: BenchmarkOutput['results'] = [];
const allFindings: BenchmarkFinding[] = [];
const allNotes: string[] = [];
let commit = 'unknown';

for (const file of benchmarkFiles) {
  console.log(`\n>>> ${file}\n`);

  const cmd = new Deno.Command('deno', {
    args: ['run', '--allow-read', '--allow-write', '--allow-run', '--allow-env', file],
    cwd: new URL('.', import.meta.url).pathname,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const status = await cmd.output();

  if (!status.success) {
    console.error(`Failed to run ${file}`);
  }
}

// Combine all results from today (only from individual suite files, not combined)
const resultsDir = new URL('./results/', import.meta.url).pathname;
const today = new Date().toISOString().slice(0, 10);
const seenResults = new Set<string>();

for await (const entry of Deno.readDir(resultsDir)) {
  // Skip combined files and only process today's individual suite results
  if (entry.isFile &&
      entry.name.includes(today) &&
      entry.name.endsWith('.json') &&
      !entry.name.startsWith('combined')) {
    try {
      const content = await Deno.readTextFile(resultsDir + entry.name);
      const data: BenchmarkOutput = JSON.parse(content);

      // Deduplicate results by name+category
      for (const result of data.results) {
        const key = `${result.category}:${result.name}`;
        if (!seenResults.has(key)) {
          seenResults.add(key);
          allResults.push(result);
        }
      }

      // Collect findings
      if (data.findings) {
        allFindings.push(...data.findings);
      }

      // Collect notes
      if (data.notes) {
        const suiteName = entry.name.replace(`-${today}.json`, '');
        allNotes.push(`[${suiteName}] ${data.notes}`);
      }

      if (data.commit !== 'unknown') {
        commit = data.commit;
      }
    } catch (e) {
      console.error(`Failed to read ${entry.name}:`, e);
    }
  }
}

// Write combined results
const combinedOutput: BenchmarkOutput = {
  timestamp: new Date().toISOString(),
  commit,
  results: allResults,
  findings: allFindings.length > 0 ? allFindings : undefined,
  notes: allNotes.length > 0 ? allNotes.join('\n\n') : undefined,
};

const combinedPath = `${resultsDir}combined-${today}.json`;
await Deno.writeTextFile(combinedPath, JSON.stringify(combinedOutput, null, 2));

console.log('\n' + '='.repeat(60));
console.log(`\nCombined ${allResults.length} benchmark results`);
if (allFindings.length > 0) {
  console.log(`Collected ${allFindings.length} findings`);
}
console.log(`Saved to: ${combinedPath}`);

// Print key findings
if (allFindings.length > 0) {
  console.log('\nKey Findings:');
  console.log('-'.repeat(60));
  for (const f of allFindings) {
    const severity = f.severity ? ` [${f.severity.toUpperCase()}]` : '';
    console.log(`• ${f.title}${severity}`);
    console.log(`  ${f.description}`);
  }
  console.log('-'.repeat(60));
}

// Print summary table
console.log('\nResults Summary:');
console.log('-'.repeat(70));
console.log('Benchmark'.padEnd(30) + 'Median'.padStart(10) + 'p95'.padStart(10) + 'p99'.padStart(10) + 'Target'.padStart(10));
console.log('-'.repeat(70));

for (const r of allResults) {
  const target = r.target !== undefined ? `${r.target}ms` : '-';
  console.log(
    r.name.slice(0, 29).padEnd(30) +
    `${r.median.toFixed(2)}ms`.padStart(10) +
    `${r.p95.toFixed(2)}ms`.padStart(10) +
    `${r.p99.toFixed(2)}ms`.padStart(10) +
    target.padStart(10)
  );
}

console.log('-'.repeat(70));
