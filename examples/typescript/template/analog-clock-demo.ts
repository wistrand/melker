#!/usr/bin/env deno run --allow-env

import { createApp, melker, getTerminalSize } from '../mod.ts';
import { CanvasElement } from '../src/components/canvas.ts';

// Analog clock rendering functions using Melker's pixel canvas
function drawClock(canvas: CanvasElement): void {
  const now = new Date();

  // Clear canvas
  canvas.clear();

  // Get canvas dimensions in pixels
  const { width, height } = canvas.getBufferSize();
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const radius = Math.min(centerX, centerY) - 4;

  // Draw outer circle
  canvas.drawCircle(centerX, centerY, radius);

  // Draw hour markers (12, 3, 6, 9)
  for (let i = 0; i < 12; i += 3) {
    const angle = (i * Math.PI) / 6;
    const x1 = centerX + Math.floor((radius - 6) * Math.cos(angle - Math.PI / 2));
    const y1 = centerY + Math.floor((radius - 6) * Math.sin(angle - Math.PI / 2));
    const x2 = centerX + Math.floor((radius - 2) * Math.cos(angle - Math.PI / 2));
    const y2 = centerY + Math.floor((radius - 2) * Math.sin(angle - Math.PI / 2));

    canvas.drawLine(x1, y1, x2, y2);
  }

  // Calculate hand angles
  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const hourAngle = (hours + minutes / 60) * (Math.PI / 6);
  const minuteAngle = minutes * (Math.PI / 30);
  const secondAngle = seconds * (Math.PI / 30);

  // Draw hour hand (shortest, thickest)
  const hourLength = Math.floor(radius * 0.4);
  const hourX = centerX + Math.floor(hourLength * Math.cos(hourAngle - Math.PI / 2));
  const hourY = centerY + Math.floor(hourLength * Math.sin(hourAngle - Math.PI / 2));
  canvas.drawLine(centerX, centerY, hourX, hourY);

  // Draw minute hand (medium length)
  const minuteLength = Math.floor(radius * 0.6);
  const minuteX = centerX + Math.floor(minuteLength * Math.cos(minuteAngle - Math.PI / 2));
  const minuteY = centerY + Math.floor(minuteLength * Math.sin(minuteAngle - Math.PI / 2));
  canvas.drawLine(centerX, centerY, minuteX, minuteY);

  // Draw second hand (longest, thinnest - simulate with dots)
  const secondLength = Math.floor(radius * 0.8);

  // Draw second hand as a series of dots
  const steps = Math.max(secondLength / 3, 1);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = centerX + Math.floor(secondLength * t * Math.cos(secondAngle - Math.PI / 2));
    const y = centerY + Math.floor(secondLength * t * Math.sin(secondAngle - Math.PI / 2));
    canvas.setPixel(x, y, true);
  }

  // Draw center dot
  canvas.fillRect(centerX - 1, centerY - 1, 3, 3);
}

function createAnalogClockDemo() {
  // Get terminal size for responsive canvas
  const terminalSize = getTerminalSize();

  // Calculate optimal canvas size to fill most of the terminal
  const canvasWidth = Math.max(20, terminalSize.width - 4); // Leave some margin
  const canvasHeight = Math.max(10, terminalSize.height - 8); // Leave space for header/footer

  // Create the clock canvas that fills the available space
  const clockCanvas = new CanvasElement({
    width: canvasWidth,
    height: canvasHeight,
    scale: 1
  });

  // Draw initial clock
  drawClock(clockCanvas);

  const ui = melker`
    <container style="width: fill; height: fill; border: thin; padding: 1; display: flex; flex-direction: column; align-items: center;">
      <text style="font-weight: bold; margin-bottom: 1; text-align: center;">
        🕐 Analog Clock
      </text>

      <container style="width: fill; height: fill; display: flex; align-items: center; justify-content: center;">
        ${clockCanvas}
      </container>

      <text style="color: gray; margin-top: 1; text-align: center; font-size: small;">
        Terminal: ${terminalSize.width}×${terminalSize.height} | Canvas: ${canvasWidth}×${canvasHeight} | Press Ctrl+C to exit
      </text>
    </container>
  `;

  // Start animation after returning the UI
  const animationInterval = setInterval(() => {
    drawClock(clockCanvas);

    // Force re-render if canvas changed
    if (clockCanvas.isDirty()) {
      const engine = (globalThis as any).melkerEngine;
      if (engine && engine.forceRender) {
        engine.forceRender();
      }
    }
  }, 1000); // Update every second

  // Store interval for cleanup
  (ui as any)._animationInterval = animationInterval;

  return ui;
}

let engine: any;
let animationInterval: number;

// Create and start the application
async function runClockDemo() {
  try {
    console.log('🕐 Starting Analog Clock Demo...');

    const ui = createAnalogClockDemo();
    engine = await createApp(ui);

    // Store engine globally for animation access
    (globalThis as any).melkerEngine = engine;

    // Store animation interval for cleanup
    animationInterval = (ui as any)._animationInterval;

    console.log('✅ Analog clock started! Watch the time tick by.');
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
  runClockDemo().catch((error) => {
    console.error(`💥 Fatal error: ${error.message}`);
    Deno.exit(1);
  });
}