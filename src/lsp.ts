// LSP entry point — can run standalone via `deno run` or be imported.
// Kept separate from melker-runner.ts so that npm:vscode-languageserver
// is never in the runner's module graph (avoids downloading it for normal app runs).
export { startLspServer, _testing } from './lsp/mod.ts';
import { isMainModule } from './runtime/mod.ts';

if (isMainModule(import.meta.main)) {
  const { startLspServer } = await import('./lsp/mod.ts');
  await startLspServer();
}
