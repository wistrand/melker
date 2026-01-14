#!/usr/bin/env -S deno run --allow-write
/**
 * Blue Noise Matrix Generator using Void-and-Cluster Algorithm
 * Generates a 64x64 grayscale PNG threshold matrix for dithering
 *
 * Based on Robert Ulichney's void-and-cluster method (1993)
 * Reference: https://blog.demofox.org/2019/06/25/generating-blue-noise-textures-with-void-and-cluster/
 *
 * Output: media/blue-noise-64.png (grayscale, 0-255 values)
 */

import { encode as encodePng } from 'npm:fast-png';

const SIZE = 64;
const SIGMA = 1.9;
const SIGMA_SQUARED_2 = 2 * SIGMA * SIGMA;

// Gaussian energy function with wrapping
function gaussianEnergy(dx: number, dy: number): number {
  // Wrap distances for tiling
  if (dx > SIZE / 2) dx = SIZE - dx;
  if (dy > SIZE / 2) dy = SIZE - dy;
  const distSq = dx * dx + dy * dy;
  return Math.exp(-distSq / SIGMA_SQUARED_2);
}

// Calculate energy at a point (sum of Gaussian contributions from all set pixels)
function calculateEnergy(pattern: boolean[], x: number, y: number): number {
  let energy = 0;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      if (pattern[py * SIZE + px]) {
        const dx = Math.abs(px - x);
        const dy = Math.abs(py - y);
        energy += gaussianEnergy(dx, dy);
      }
    }
  }
  return energy;
}

// Find tightest cluster (highest energy set pixel)
function findTightestCluster(pattern: boolean[], energy: number[]): number {
  let maxEnergy = -Infinity;
  let maxIdx = -1;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (pattern[i] && energy[i] > maxEnergy) {
      maxEnergy = energy[i];
      maxIdx = i;
    }
  }
  return maxIdx;
}

// Find largest void (lowest energy unset pixel)
function findLargestVoid(pattern: boolean[], energy: number[]): number {
  let minEnergy = Infinity;
  let minIdx = -1;
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (!pattern[i] && energy[i] < minEnergy) {
      minEnergy = energy[i];
      minIdx = i;
    }
  }
  return minIdx;
}

// Update energy array after toggling a pixel
function updateEnergy(energy: number[], x: number, y: number, delta: number): void {
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const dx = Math.abs(px - x);
      const dy = Math.abs(py - y);
      energy[py * SIZE + px] += delta * gaussianEnergy(dx, dy);
    }
  }
}

// Generate blue noise threshold matrix
function generateBlueNoise(): number[] {
  const totalPixels = SIZE * SIZE;
  const initialWhite = Math.floor(totalPixels * 0.1); // Start with ~10% white

  console.log(`Generating ${SIZE}x${SIZE} blue noise matrix...`);
  console.log(`Initial white pixels: ${initialWhite}`);

  // Phase 1: Create initial binary pattern with good distribution
  const pattern: boolean[] = new Array(totalPixels).fill(false);
  const ranking: number[] = new Array(totalPixels).fill(0);

  // Randomly place initial white pixels
  const indices = Array.from({ length: totalPixels }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  for (let i = 0; i < initialWhite; i++) {
    pattern[indices[i]] = true;
  }

  // Calculate initial energy
  console.log('Calculating initial energy...');
  const energy: number[] = new Array(totalPixels);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      energy[y * SIZE + x] = calculateEnergy(pattern, x, y);
    }
  }

  // Phase 1: Optimize initial pattern by swapping clusters and voids
  console.log('Phase 1: Optimizing initial pattern...');
  let swaps = 0;
  const maxSwaps = 100000;
  for (let iter = 0; iter < maxSwaps; iter++) {
    const cluster = findTightestCluster(pattern, energy);
    const void_ = findLargestVoid(pattern, energy);

    if (cluster === -1 || void_ === -1) break;
    if (energy[cluster] <= energy[void_]) break; // Converged

    // Swap
    pattern[cluster] = false;
    pattern[void_] = true;

    const cx = cluster % SIZE, cy = Math.floor(cluster / SIZE);
    const vx = void_ % SIZE, vy = Math.floor(void_ / SIZE);
    updateEnergy(energy, cx, cy, -1);
    updateEnergy(energy, vx, vy, +1);

    swaps++;
    if (swaps % 1000 === 0) {
      console.log(`  Swaps: ${swaps}, cluster energy: ${energy[cluster].toFixed(4)}, void energy: ${energy[void_].toFixed(4)}`);
    }
  }
  console.log(`  Total swaps: ${swaps}`);

  // Phase 2: Remove pixels to create ranking (assigns values 0 to initialWhite-1)
  console.log('Phase 2: Removing pixels to create ranking...');
  let rank = initialWhite - 1;
  const workPattern = [...pattern];
  while (rank >= 0) {
    const cluster = findTightestCluster(workPattern, energy);
    if (cluster === -1) break;

    ranking[cluster] = rank;
    workPattern[cluster] = false;

    const cx = cluster % SIZE, cy = Math.floor(cluster / SIZE);
    updateEnergy(energy, cx, cy, -1);
    rank--;
  }

  // Phase 3: Add pixels to create ranking (assigns values initialWhite to totalPixels-1)
  console.log('Phase 3: Adding pixels to create ranking...');
  // Reset energy for the original pattern
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      energy[y * SIZE + x] = calculateEnergy(pattern, x, y);
    }
  }

  const addPattern = [...pattern];
  rank = initialWhite;
  while (rank < totalPixels) {
    const void_ = findLargestVoid(addPattern, energy);
    if (void_ === -1) break;

    ranking[void_] = rank;
    addPattern[void_] = true;

    const vx = void_ % SIZE, vy = Math.floor(void_ / SIZE);
    updateEnergy(energy, vx, vy, +1);
    rank++;

    if (rank % 500 === 0) {
      console.log(`  Progress: ${rank}/${totalPixels}`);
    }
  }

  // Normalize to 0-255 range (full grayscale range for PNG)
  const normalized = ranking.map(r => Math.floor(r * 256 / totalPixels));

  console.log('Done!');
  return normalized;
}

// Main
const matrix = generateBlueNoise();

// Create grayscale PNG data (1 channel)
const pngData = new Uint8Array(SIZE * SIZE);
for (let i = 0; i < SIZE * SIZE; i++) {
  pngData[i] = matrix[i];
}

// Encode as PNG
const png = encodePng({
  width: SIZE,
  height: SIZE,
  data: pngData,
  channels: 1,  // Grayscale
  depth: 8,
});

// Write to media directory
const outputPath = new URL('../media/blue-noise-64.png', import.meta.url).pathname;
await Deno.writeFile(outputPath, png);
console.log(`\nMatrix written to ${outputPath}`);
