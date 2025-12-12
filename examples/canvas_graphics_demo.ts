// Canvas Graphics Demo - Shows off canvas component capabilities
// Usage: deno run --allow-env examples/canvas_graphics_demo.ts

import {
  createApp,
  melker,
  getTerminalSize,
  getThemeColor,
  type Element
} from '../melker.ts';
import { CanvasElement } from '../src/components/canvas.ts';

function printUsage() {
  console.log('🎨 Melker Canvas Graphics Demo');
  console.log('Usage: deno run --allow-env examples/canvas_graphics_demo.ts');
  console.log('');
  console.log('Features:');
  console.log('  🎯 Canvas component with pixel-perfect graphics');
  console.log('  📐 Basic shapes: rectangles, circles, lines');
  console.log('  🎨 Filled shapes and outlines');
  console.log('  📏 Scalable pixel buffers');
  console.log('  🔤 Unicode sextant character rendering');
  console.log('');
  console.log('Controls:');
  console.log('  Ctrl+C - Quit');
}

function createCanvasDemo(): Element {
  const terminalSize = getTerminalSize();

  // Create multiple canvases to showcase different features
  const canvas1 = new CanvasElement({
    width: 20,
    height: 10,
    scale: 1
  });

  const canvas2 = new CanvasElement({
    width: 15,
    height: 8,
    scale: 2
  });

  const canvas3 = new CanvasElement({
    width: 25,
    height: 6,
    scale: 1
  });

  // Draw on first canvas - basic shapes
  canvas1.clear();
  canvas1.drawRect(2, 2, 16, 8);          // Rectangle outline
  canvas1.fillRect(4, 4, 6, 3);           // Filled rectangle
  canvas1.drawLine(0, 0, 19, 9);          // Diagonal line
  canvas1.drawCircle(14, 6, 3);           // Circle

  // Draw on second canvas - higher resolution due to scale=2
  canvas2.clear();
  canvas2.drawRect(1, 1, 28, 14);         // Border
  canvas2.fillRect(5, 5, 8, 4);           // Central filled rect
  canvas2.drawCircle(20, 8, 5);           // Large circle
  canvas2.drawLine(2, 2, 27, 13);         // Diagonal

  // Individual pixels for detail
  for (let i = 0; i < 10; i++) {
    canvas2.setPixel(8 + i, 2, true);
    canvas2.setPixel(8 + i, 3, true);
  }

  // Draw on third canvas - pattern demo
  canvas3.clear();
  // Draw a pattern of small rectangles
  for (let x = 0; x < 50; x += 8) {
    for (let y = 0; y < 18; y += 6) {
      canvas3.drawRect(x, y, 6, 4);
      if ((x + y) % 16 === 0) {
        canvas3.fillRect(x + 1, y + 1, 4, 2);
      }
    }
  }

  // Create UI layout
  const mainStyle = {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    width: Math.min(terminalSize.width, 70),
    height: Math.min(terminalSize.height, 35),
    border: 'thin' as const,
    borderColor: getThemeColor('primary'),
    padding: 1
  };

  const headerStyle = {
    fontWeight: 'bold' as const,
    color: getThemeColor('primary'),
    marginBottom: 1
  };

  const sectionStyle = {
    marginBottom: 2
  };

  const labelStyle = {
    color: getThemeColor('textSecondary'),
    marginBottom: 1
  };

  return melker`
    <container style=${mainStyle}>
      <text style=${headerStyle}>Canvas Graphics Demo</text>

      <container style=${sectionStyle}>
        <text style=${labelStyle}>Basic Shapes (Scale 1x):</text>
        ${canvas1}
      </container>

      <container style=${sectionStyle}>
        <text style=${labelStyle}>High Resolution (Scale 2x):</text>
        ${canvas2}
      </container>

      <container style=${sectionStyle}>
        <text style=${labelStyle}>Pattern Generation:</text>
        ${canvas3}
      </container>

      <text style=${{ color: getThemeColor('textMuted'), marginTop: 1 }}>
        Canvas features: setPixel(), drawRect(), fillRect(), drawLine(), drawCircle()
      </text>
    </container>
  `;
}

let engine: any;

async function runCanvasDemo() {
  const args = Deno.args;

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  try {
    const ui = createCanvasDemo();
    engine = await createApp(ui);

  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  runCanvasDemo().catch((error) => {
    console.error(`💥 Fatal error: ${error.message}`);
    Deno.exit(1);
  });
}

export { createCanvasDemo };