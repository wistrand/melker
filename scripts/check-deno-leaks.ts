/**
 * Scans src/ for direct Deno.* API usage outside of src/runtime/deno/.
 * Exits with code 1 if any leaks are found.
 *
 * Allowed exceptions:
 * - src/runtime/deno/ (the Deno implementation layer itself)
 * - Comments (lines starting with //, *, or inside JSDoc)
 * - String literals containing "Deno." in generated code (generator.ts)
 * - melker-launcher.ts (intentionally Deno-coupled, not ported)
 */

const ALLOWED_PATHS = [
  'src/runtime/deno/',
];

// Files where Deno.* in string literals is expected (generated code)
const GENERATED_CODE_FILES = [
  'src/bundler/generator.ts',
];

const decoder = new TextDecoder();
const leaks: { file: string; line: number; content: string }[] = [];

for await (const entry of walkDir('src')) {
  if (!entry.endsWith('.ts')) continue;
  if (ALLOWED_PATHS.some((p) => entry.startsWith(p))) continue;

  const text = decoder.decode(Deno.readFileSync(entry));
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // Skip lines without Deno.
    if (!line.includes('Deno.')) continue;

    // Check if Deno. only appears inside string literals on this line.
    // Strip all quoted strings and check if Deno. remains.
    const stripped = trimmed
      .replace(/`[^`]*`/g, '')      // template literals (single-line)
      .replace(/'[^']*'/g, '')      // single-quoted strings
      .replace(/"[^"]*"/g, '');     // double-quoted strings
    if (!stripped.includes('Deno.')) continue;

    // In generator files, skip generated code lines (addLine calls, template content)
    if (GENERATED_CODE_FILES.some((f) => entry.endsWith(f))) {
      if (trimmed.startsWith('return Deno.inspect') || trimmed.startsWith('addLine(')) {
        continue;
      }
    }

    leaks.push({ file: entry, line: i + 1, content: line.trim() });
  }
}

if (leaks.length > 0) {
  console.error(`\nFound ${leaks.length} Deno API leak(s) outside src/runtime/deno/:\n`);
  for (const leak of leaks) {
    console.error(`  ${leak.file}:${leak.line}: ${leak.content}`);
  }
  console.error('\nFix these by importing from src/runtime/mod.ts instead.');
  Deno.exit(1);
} else {
  console.log('No Deno API leaks found outside src/runtime/deno/.');
}

async function* walkDir(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      yield* walkDir(path);
    } else {
      yield path;
    }
  }
}
