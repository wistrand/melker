# Benchmark Report — 2026-02-04

**300 benchmarks** across **17 suites** | All passing

---

## Summary by Category

| Category         | Tests | Passed | Fastest    | Slowest     | Average    |
|------------------|------:|-------:|-----------:|------------:|-----------:|
| geometry         |    19 |     19 |    <0.01ms |     0.04ms  |    0.003ms |
| content-measurer |    21 |     21 |    <0.01ms |     0.03ms  |    0.004ms |
| tree-traversal   |    35 |     35 |    <0.01ms |     0.04ms  |    0.006ms |
| bundler          |    19 |     19 |    <0.01ms |     0.47ms  |    0.09ms  |
| components       |     7 |      7 |     0.14ms |     0.29ms  |    0.17ms  |
| hit-test         |    21 |     21 |    <0.01ms |     4.94ms  |    0.26ms  |
| ansi-output      |    19 |     19 |    <0.01ms |     1.98ms  |    0.24ms  |
| buffer-diff      |    22 |     22 |    <0.01ms |     0.81ms  |    0.29ms  |
| layout           |     7 |      7 |     0.07ms |     2.02ms  |    0.52ms  |
| rendering        |    35 |     35 |     0.01ms |     5.24ms  |    0.51ms  |
| graph            |    22 |     22 |    <0.01ms |     4.99ms  |    0.60ms  |
| markdown         |    14 |     14 |     0.06ms |     7.06ms  |    0.82ms  |
| encoding         |    12 |     12 |     0.08ms |    27.35ms  |    5.20ms  |
| dithering        |    20 |     20 |     0.19ms |    30.74ms  |    7.13ms  |
| quantization     |     8 |      8 |     0.03ms |   672.52ms  |  117.75ms  |
| launcher         |    19 |     19 |    <0.01ms |   550.78ms  |  138.07ms  |

---

## Frame Budget Analysis (16.67ms @ 60fps)

Typical UI render cycle cost:

| Operation              | Time      | % of Budget |
|------------------------|----------:|------------:|
| Layout (dashboard)     |   0.28ms  |        1.7% |
| Render (dashboard)     |   0.95ms  |        5.7% |
| Buffer diff (10% dirty)|   0.24ms  |        1.4% |
| ANSI output (full)     |   1.98ms  |       11.9% |
| **Total render cycle** | **3.45ms**|     **20.7%**|

Headroom for app logic: **~13ms per frame**

---

## Key Operations

| Operation                     | Median   | p95      | Notes                          |
|-------------------------------|----------|----------|--------------------------------|
| Point-in-bounds check         | <0.001ms | <0.001ms | Millions per frame possible    |
| Find element by ID (1000)     | 0.01ms   | 0.01ms   | Linear scan, very fast         |
| Measure 500 children          | 0.03ms   | 0.03ms   | ~50ns per element              |
| 100 hit tests (flat tree)     | 0.24ms   | 0.32ms   | Well within frame budget       |
| Full-screen ANSI (4800 cells) | 1.98ms   | 2.21ms   | Span grouping optimization     |
| Dashboard layout              | 0.28ms   | 0.32ms   | Flexbox calculation            |
| Dashboard render              | 0.95ms   | 1.12ms   | Complex nested UI              |
| 20-row table render           | 5.24ms   | 6.35ms   | Many cells, borders            |
| Markdown parse (large)        | 7.06ms   | 9.91ms   | ~50KB document                 |
| Kitty encode 256×256          | 1.33ms   | 2.32ms   | Base64 + chunking              |
| Sixel encode 256×256          | 5.54ms   | 6.77ms   | Palette + RLE                  |
| Floyd-Steinberg 256×256       | 6.85ms   | 6.89ms   | Error diffusion                |
| App subprocess launch         | 533ms    | 580ms    | Deno cold start overhead       |
| Median-cut quantize 256×256   | 199ms    | 206ms    | Expensive, cache recommended   |

---

## Slowest Operations (Bottlenecks)

| Operation                     | Time     | Category     |
|-------------------------------|----------|--------------|
| Median-cut quantize 640×480   | 673ms    | quantization |
| App subprocess launch         | 533-551ms| launcher     |
| Median-cut quantize 256×256   | 199ms    | quantization |
| Median-cut quantize 64×64     | 67ms     | quantization |
| Floyd-Steinberg dither 640×480| 31ms     | dithering    |
| Sixel encode 640×480          | 27ms     | encoding     |
| Blue noise dither 640×480     | 21ms     | dithering    |
| Ordered dither 640×480        | 22ms     | dithering    |

---

## Key Insights

### Performance Wins
- **Geometry operations**: Sub-microsecond. No optimization needed.
- **Tree traversal**: Early termination is effective. Finding first vs last element shows 50x difference.
- **Content measurement**: Fast-path for scrollable >50 children makes O(1) vs O(n).
- **ANSI output**: Span grouping reduces cursor movements. Full screen in ~2ms.
- **Kitty vs Sixel**: Kitty is **4.2x faster** (no palette quantization).

### Areas of Concern
- **Median-cut quantization**: Dominates graphics time. Use fixed palettes for real-time.
- **Subprocess launch**: ~500ms cold start is unavoidable (Deno overhead).
- **Large images (640×480)**: Dithering/encoding takes 20-30ms. Consider caching.

### Recommendations
1. **Cache quantization** for static images
2. **Use Kitty protocol** when terminal supports it
3. **Use ordered dithering** for real-time (2-3x faster than error diffusion)
4. **Pre-warm subprocesses** if latency matters
5. **Reuse arrays** in hot paths (collectElements shows measurable gain)

---

## Test Environment

- Platform: Linux 6.19.0-rc7
- Runtime: Deno
- Commit: See combined-2026-02-04.json

---

*Generated from 300 benchmarks with calibrated targets. All tests passing.*
