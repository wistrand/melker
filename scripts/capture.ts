#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

/**
 * capture.ts - Capture screenshots and videos of Melker apps using Xvfb
 *
 * Usage:
 *   # Run from config file
 *   ./scripts/capture.ts [config.json]
 *
 *   # Default config: scripts/capture-config.json
 *   ./scripts/capture.ts
 *
 * Dependencies:
 *   - Xvfb (xorg-server-xvfb)
 *   - ImageMagick (import, convert)
 *   - ffmpeg (for video capture)
 *   - kitty or xterm
 */

import { join, dirname, basename } from "jsr:@std/path@1.1.4";

// ============================================================================
// Types
// ============================================================================

interface CaptureItem {
  /** Path to the .melker file (relative to project root) */
  app: string;
  /** Arguments to pass to the app */
  args?: string[];
  /** Capture type: "screenshot" or "video" */
  type?: "screenshot" | "video";
  /** Output filename (without extension, auto-generated if not specified) */
  output?: string;
  /** Delay before capture in seconds */
  delay?: number;
  /** Video duration in seconds (only for video type) */
  duration?: number;
  /** Video framerate (only for video type) */
  fps?: number;
  /** Skip this item */
  skip?: boolean;
  /** Human-readable description */
  description?: string;
  /** Graphics mode (sextant, block, sixel, pattern, luma) */
  gfxMode?: string;
}

interface CaptureConfig {
  /** Default settings applied to all items */
  defaults?: {
    type?: "screenshot" | "video";
    delay?: number;
    duration?: number;
    fps?: number;
    resolution?: string;
    terminal?: string;
    thumbnailWidth?: number;
  };
  /** Output directories */
  output?: {
    screenshots?: string;
    videos?: string;
    thumbnails?: string;
  };
  /** Items to capture */
  items: CaptureItem[];
}

interface ProcessResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

// ============================================================================
// Utilities
// ============================================================================

async function run(cmd: string[], options?: { timeout?: number }): Promise<ProcessResult> {
  const process = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await process.output();

  return {
    success: code === 0,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
    code,
  };
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const result = await run(["which", cmd]);
    return result.success;
  } catch {
    return false;
  }
}

async function checkDependencies(needVideo: boolean): Promise<void> {
  const deps = [
    { cmd: "Xvfb", pkg: "xorg-server-xvfb" },
    { cmd: "import", pkg: "imagemagick" },
    { cmd: "convert", pkg: "imagemagick" },
    { cmd: "kitty", pkg: "kitty" },
  ];

  if (needVideo) {
    deps.push({ cmd: "ffmpeg", pkg: "ffmpeg" });
  }

  for (const dep of deps) {
    if (!(await commandExists(dep.cmd))) {
      console.error(`Error: ${dep.cmd} not found. Install with: sudo pacman -S ${dep.pkg}`);
      Deno.exit(1);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Capture Logic
// ============================================================================

class Capturer {
  private projectDir: string;
  private config: CaptureConfig;
  private xvfbProcess: Deno.ChildProcess | null = null;
  private terminalProcess: Deno.ChildProcess | null = null;
  private displayNum = 99;

  constructor(projectDir: string, config: CaptureConfig) {
    this.projectDir = projectDir;
    this.config = config;
  }

  private get defaults() {
    return {
      type: "screenshot" as const,
      delay: 2,
      duration: 3,
      fps: 30,
      resolution: "1280x900x24",
      terminal: "kitty",
      thumbnailWidth: 320,
      ...this.config.defaults,
    };
  }

  private get outputDirs() {
    return {
      screenshots: this.config.output?.screenshots ?? "docs/screenshots",
      videos: this.config.output?.videos ?? "docs/screenshots/videos",
      thumbnails: this.config.output?.thumbnails ?? "docs/screenshots/thumbnails",
    };
  }

  private parseResolution(): { width: number; height: number } {
    const [width, height] = this.defaults.resolution.split("x").map(Number);
    return { width, height };
  }

  async startXvfb(): Promise<void> {
    console.log(`Starting Xvfb on :${this.displayNum}...`);

    const cmd = new Deno.Command("Xvfb", {
      args: [`:${this.displayNum}`, "-screen", "0", this.defaults.resolution],
      stdout: "null",
      stderr: "null",
    });

    this.xvfbProcess = cmd.spawn();
    await sleep(500);
  }

  async stopXvfb(): Promise<void> {
    if (this.xvfbProcess) {
      try {
        this.xvfbProcess.kill("SIGTERM");
      } catch {
        // Ignore
      }
      this.xvfbProcess = null;
    }
  }

  async startTerminal(app: string, args: string[], gfxMode?: string): Promise<void> {
    const melkerPath = join(this.projectDir, "melker.ts");
    const appPath = join(this.projectDir, app);
    const { width, height } = this.parseResolution();

    const gfxFlag = gfxMode ? `--gfx-mode=${gfxMode}` : "";
    const shellCmd = [
      `cd '${this.projectDir}'`,
      `deno run -A '${melkerPath}' --trust ${gfxFlag} '${appPath}' ${args.map((a) => `'${a}'`).join(" ")}`,
      "sleep 999",
    ].join(" && ");

    const kittyArgs = [
      "--config", "NONE",
      "--single-instance=no",
      "-o", "linux_display_server=x11",
      "-o", "font_size=11",
      "-o", "font_family=JetBrains Mono",
      "-o", "remember_window_size=no",
      "-o", `initial_window_width=${width}`,
      "-o", `initial_window_height=${height}`,
      "-o", "window_padding_width=0",
      "-o", "placement_strategy=top-left",
      "-o", "hide_window_decorations=yes",
      "-o", "background=#1e1e2e",
      "-o", "foreground=#cdd6f4",
      "-e", "bash", "-c", shellCmd,
    ];

    const cmd = new Deno.Command("kitty", {
      args: kittyArgs,
      env: {
        ...Deno.env.toObject(),
        DISPLAY: `:${this.displayNum}`,
        WAYLAND_DISPLAY: "", // Force X11
      },
      stdout: "null",
      stderr: "null",
    });

    this.terminalProcess = cmd.spawn();
  }

  async stopTerminal(): Promise<void> {
    if (this.terminalProcess) {
      try {
        this.terminalProcess.kill("SIGTERM");
      } catch {
        // Ignore
      }
      this.terminalProcess = null;
    }
  }

  async captureScreenshot(outputPath: string): Promise<void> {
    console.log("  Capturing screenshot...");

    // Capture with ImageMagick
    await run([
      "import",
      "-window", "root",
      "-display", `:${this.displayNum}`,
      outputPath,
    ]);

    // Trim black borders
    await run(["convert", outputPath, "-trim", "+repage", outputPath]);
  }

  async captureVideo(outputPath: string, duration: number, fps: number): Promise<void> {
    console.log(`  Recording ${duration}s video at ${fps}fps...`);

    const { width, height } = this.parseResolution();
    const tempPath = outputPath.replace(/\.mp4$/, "-raw.mp4");

    // Capture video
    await run([
      "ffmpeg", "-y",
      "-f", "x11grab",
      "-video_size", `${width}x${height}`,
      "-framerate", String(fps),
      "-i", `:${this.displayNum}`,
      "-t", String(duration),
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      tempPath,
    ]);

    // Detect crop area
    console.log("  Detecting crop area...");
    const cropResult = await run([
      "ffmpeg", "-i", tempPath,
      "-vframes", "10",
      "-vf", "cropdetect=24:2:0",
      "-f", "null", "-",
    ]);

    const cropMatch = cropResult.stderr.match(/crop=(\d+:\d+:\d+:\d+)/g);
    const crop = cropMatch ? cropMatch[cropMatch.length - 1] : null;

    if (crop) {
      console.log(`  Applying crop: ${crop}`);
      await run([
        "ffmpeg", "-y",
        "-i", tempPath,
        "-vf", crop,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        outputPath,
      ]);
      await Deno.remove(tempPath);
    } else {
      await Deno.rename(tempPath, outputPath);
    }
  }

  async generateThumbnail(sourcePath: string, thumbPath: string): Promise<void> {
    const width = this.defaults.thumbnailWidth;

    if (sourcePath.endsWith(".mp4")) {
      // Extract first frame from video
      await run([
        "ffmpeg", "-y",
        "-i", sourcePath,
        "-vframes", "1",
        "-vf", `scale=${width}:-1`,
        thumbPath,
      ]);
    } else {
      // Resize image
      await run(["convert", sourcePath, "-resize", `${width}x`, thumbPath]);
    }
  }

  private buildMelkerCommand(app: string, args: string[], gfxMode?: string): string {
    const gfxFlag = gfxMode ? `--gfx-mode=${gfxMode} ` : "";
    const appArgs = args.length ? " " + args.map((a) => `'${a}'`).join(" ") : "";
    return `./melker.ts --trust ${gfxFlag}'${app}'${appArgs}`;
  }

  async captureItem(item: CaptureItem, dryRun: boolean): Promise<void> {
    const type = item.type ?? this.defaults.type;
    const delay = item.delay ?? this.defaults.delay;
    const duration = item.duration ?? this.defaults.duration;
    const fps = item.fps ?? this.defaults.fps;
    const args = item.args ?? [];
    const gfxMode = item.gfxMode;

    const appBasename = basename(item.app, ".melker");
    const outputName = item.output ?? appBasename;

    const isVideo = type === "video";
    const ext = isVideo ? ".mp4" : ".png";
    const outputDir = isVideo ? this.outputDirs.videos : this.outputDirs.screenshots;
    const outputPath = join(this.projectDir, outputDir, outputName + ext);
    const thumbPath = join(this.projectDir, this.outputDirs.thumbnails, outputName + ".png");

    const melkerCmd = this.buildMelkerCommand(item.app, args, gfxMode);

    console.log(`\n${item.description ?? item.app}`);
    console.log(`  Command: ${melkerCmd}`);
    console.log(`  Output:  ${basename(outputPath)} (${type}${isVideo ? `, ${duration}s` : ""})`);

    if (dryRun) {
      return;
    }

    // Ensure directories exist
    await Deno.mkdir(dirname(outputPath), { recursive: true });
    await Deno.mkdir(dirname(thumbPath), { recursive: true });

    // Start terminal with app
    await this.startTerminal(item.app, args, gfxMode);

    // Wait for render
    console.log(`  Waiting ${delay}s for app to render...`);
    await sleep(delay * 1000);

    // Capture
    if (isVideo) {
      await this.captureVideo(outputPath, duration, fps);
    } else {
      await this.captureScreenshot(outputPath);
    }

    // Generate thumbnail
    await this.generateThumbnail(outputPath, thumbPath);
    console.log(`  Thumbnail: ${thumbPath}`);

    // Stop terminal
    await this.stopTerminal();
  }

  async run(dryRun: boolean): Promise<void> {
    const items = this.config.items.filter((item) => !item.skip);
    const needVideo = items.some((item) => (item.type ?? this.defaults.type) === "video");

    if (dryRun) {
      console.log("Dry run mode - no captures will be performed\n");
      for (const item of items) {
        await this.captureItem(item, true);
      }
      console.log(`\nDry run complete. Would capture ${items.length} items.`);
      return;
    }

    await checkDependencies(needVideo);
    await this.startXvfb();

    try {
      for (const item of items) {
        await this.captureItem(item, false);
      }
    } finally {
      await this.stopTerminal();
      await this.stopXvfb();
    }

    console.log(`\nDone! Captured ${items.length} items.`);
  }
}

// ============================================================================
// Main
// ============================================================================

function printUsage(): void {
  console.log(`Usage: capture.ts [options] [config.json]

Options:
  --dry-run    Show what would be captured without actually capturing
  --help       Show this help message

Arguments:
  config.json  Path to config file (default: scripts/capture-config.json)
`);
}

async function main() {
  // Parse arguments
  const args = [...Deno.args];
  let dryRun = false;
  let configArg: string | undefined;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      Deno.exit(0);
    } else if (!arg.startsWith("-")) {
      configArg = arg;
    }
  }

  // Find project root (where melker.ts is)
  let projectDir = Deno.cwd();
  while (projectDir !== "/") {
    try {
      await Deno.stat(join(projectDir, "melker.ts"));
      break;
    } catch {
      projectDir = dirname(projectDir);
    }
  }

  if (projectDir === "/") {
    console.error("Error: Could not find melker.ts in any parent directory");
    Deno.exit(1);
  }

  // Load config
  const configPath = configArg ?? join(projectDir, "scripts/capture-config.json");
  let config: CaptureConfig;

  try {
    const configText = await Deno.readTextFile(configPath);
    config = JSON.parse(configText);
  } catch (e) {
    if (Deno.args[0]) {
      console.error(`Error: Could not load config file: ${configPath}`);
      Deno.exit(1);
    }
    console.error(`No config file found at ${configPath}`);
    console.error("Create one or specify a config file as argument.");
    console.error("\nExample config:");
    console.error(JSON.stringify({
      defaults: { delay: 2, duration: 3 },
      items: [
        { app: "examples/showcase/breakout.melker" },
        { app: "examples/canvas/shaders/plasma-shader.melker", type: "video", duration: 5 },
      ],
    }, null, 2));
    Deno.exit(1);
  }

  const capturer = new Capturer(projectDir, config);
  await capturer.run(dryRun);
}

main();
