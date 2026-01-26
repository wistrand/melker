// Animated Sine Wave Canvas Demo
// Usage: deno run --allow-env examples/canvas_sine_wave_demo.ts

import {
  createApp,
  melker,
  getTerminalSize,
  getThemeColor,
  type Element
} from '../mod.ts';
import { CanvasElement } from '../src/components/canvas.ts';

function printUsage() {
  console.log('🌊 Animated Sine Wave Canvas Demo');
  console.log('Usage: deno run --allow-env examples/canvas_sine_wave_demo.ts');
  console.log('');
  console.log('Features:');
  console.log('  🌊 Animated sine wave visualization');
  console.log('  📈 Real-time mathematical function plotting');
  console.log('  🎨 Multiple frequency and amplitude variations');
  console.log('  ⏱️  Smooth animation with phase shifting');
  console.log('  📊 Grid overlay for reference');
  console.log('');
  console.log('Controls:');
  console.log('  Ctrl+C - Quit');
}

function createSineWaveDemo(): Element {
  const terminalSize = getTerminalSize();

  // Create canvas for sine wave animation
  const canvas = new CanvasElement({
    width: 50,
    height: 20,
    scale: 1
  });

  // Animation variables
  let phase = 0;
  let frameCount = 0;

  // Function to draw sine wave
  const drawSineWave = () => {
    canvas.clear();

    // Draw grid for reference
    drawGrid();

    // Draw multiple sine waves with different properties
    drawWave(1, 1, phase); // Main wave
    drawWave(0.5, 2, phase * 1.5); // Harmonics
    drawWave(1.5, 0.5, phase * 0.7); // Low frequency wave

    // Draw axes
    drawAxes();

    // Update animation with smaller steps for smoother motion
    phase += 0.15;
    frameCount++;
  };

  const drawGrid = () => {
    // Draw horizontal grid lines
    for (let y = 5; y < canvas.getBufferSize().height; y += 10) {
      for (let x = 0; x < canvas.getBufferSize().width; x += 4) {
        canvas.setPixel(x, y, true);
      }
    }

    // Draw vertical grid lines
    for (let x = 10; x < canvas.getBufferSize().width; x += 20) {
      for (let y = 0; y < canvas.getBufferSize().height; y += 4) {
        canvas.setPixel(x, y, true);
      }
    }
  };

  const drawAxes = () => {
    const centerY = Math.floor(canvas.getBufferSize().height / 2);
    const width = canvas.getBufferSize().width;

    // Draw X-axis
    for (let x = 0; x < width; x++) {
      canvas.setPixel(x, centerY, true);
    }

    // Draw Y-axis
    for (let y = 0; y < canvas.getBufferSize().height; y++) {
      canvas.setPixel(10, y, true);
    }
  };

  const drawWave = (amplitude: number, frequency: number, phaseShift: number) => {
    const centerY = Math.floor(canvas.getBufferSize().height / 2);
    const width = canvas.getBufferSize().width;
    const height = canvas.getBufferSize().height;

    let lastX = 0;
    let lastY = centerY;

    for (let x = 0; x < width; x++) {
      // Calculate sine wave
      const angle = (x - 10) * frequency * 0.1 + phaseShift;
      const sineValue = Math.sin(angle) * amplitude * 8; // Scale amplitude
      const y = Math.round(centerY - sineValue);

      // Ensure y is within bounds
      if (y >= 0 && y < height) {
        // Draw line from last point to current point for smooth curve
        if (x > 0) {
          canvas.drawLine(lastX, lastY, x, y);
        }
        lastX = x;
        lastY = y;

        // Add extra emphasis at peak points
        if (Math.abs(sineValue) > amplitude * 6) {
          canvas.setPixel(x, y, true);
        }
      }
    }
  };

  // Create UI layout
  const mainStyle = {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    width: Math.min(terminalSize.width, 60),
    height: Math.min(terminalSize.height, 30),
    border: 'thin' as const,
    borderColor: getThemeColor('primary'),
    padding: 1
  };

  const headerStyle = {
    fontWeight: 'bold' as const,
    color: getThemeColor('primary'),
    marginBottom: 1
  };

  const infoStyle = {
    color: getThemeColor('textSecondary'),
    marginBottom: 1
  };

  const footerStyle = {
    color: getThemeColor('textMuted'),
    marginTop: 1,
    fontSize: 'small' as const
  };

  const ui = melker`
    <container style=${mainStyle}>
      <text style=${headerStyle}>🌊 Animated Sine Wave Demo</text>
      <text style=${infoStyle}>Frequency: Multiple waves | Amplitude: Variable | Phase: Animated</text>

      ${canvas}

      <text style=${footerStyle}>
        Mathematical visualization using canvas pixel plotting • Press Ctrl+C to exit
      </text>
    </container>
  `;

  // Start animation
  const animationInterval = setInterval(() => {
    drawSineWave();

    // Only force re-render if canvas actually changed
    if (canvas.isDirty()) {
      const engine = (globalThis as any).melkerEngine;
      if (engine && engine.forceRender) {
        engine.forceRender();
      }
    }
  }, 1000.0/24); // Slower refresh rate to reduce flicker

  // Store interval for cleanup
  (ui as any)._animationInterval = animationInterval;

  return ui;
}

let engine: any;
let animationInterval: number;

async function runSineWaveDemo() {
  const args = Deno.args;

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  try {
    console.log('🌊 Starting Animated Sine Wave Demo...');

    const ui = createSineWaveDemo();
    engine = await createApp(ui);

    // Store animation interval for cleanup
    animationInterval = (ui as any)._animationInterval;

    console.log('✅ Sine wave animation started! Watch the mathematical curves in motion.');
    console.log('Press Ctrl+C to exit.');

    // Handle cleanup on exit
    const handleExit = () => {
      if (animationInterval) {
        clearInterval(animationInterval);
      }
      if (engine && engine.stop) {
        engine.stop();
      }
      Deno.exit(0);
    };

    // Listen for Ctrl+C
    Deno.addSignalListener('SIGINT', handleExit);

  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  runSineWaveDemo().catch((error) => {
    console.error(`💥 Fatal error: ${error.message}`);
    Deno.exit(1);
  });
}

export { createSineWaveDemo };