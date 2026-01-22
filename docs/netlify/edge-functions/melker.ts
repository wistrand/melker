// Netlify Edge Function for dynamic Melker launcher
//
// Serves versioned launchers based on URL pattern:
//   /melker.ts          -> latest from main branch
//   /melker-v2026.01.1.ts -> specific CalVer tag
//   /melker-abc123f.ts  -> specific commit hash
//
// Non-existent versions show a clean error instead of stack trace.

export default async (request: Request) => {
  const url = new URL(request.url);

  // Parse: /melker.ts or /melker-<ref>.ts
  const match = url.pathname.match(/^\/melker(?:-([a-zA-Z0-9.]+))?\.ts$/);
  if (!match) {
    return new Response('Not found', { status: 404 });
  }

  const ref = match[1] || 'main';

  // Build GitHub raw URL
  // Tags start with 'v', otherwise treat as branch or commit hash
  const isTag = ref.startsWith('v');
  const refPath = isTag
    ? `refs/tags/${ref}`
    : ref === 'main'
      ? 'refs/heads/main'
      : ref; // commit hash

  const githubUrl = `https://raw.githubusercontent.com/wistrand/melker/${refPath}/melker-launcher.ts`;

  const versionSuffix = ref === 'main' ? '' : `-${ref}`;
  const launcher = `// Melker CLI - Version: ${ref}
// https://melker.sh/melker${versionSuffix}.ts
//
// Run Melker apps without cloning:
//   deno run --allow-all https://melker.sh/melker${versionSuffix}.ts app.melker
//
// To bypass Deno's module cache and fetch the latest:
//   deno run --allow-all --reload --no-lock https://melker.sh/melker${versionSuffix}.ts app.melker
//
// Deno flags forwarded to app subprocess:
//   --reload, --no-lock, --no-check, --quiet/-q, --cached-only

if (import.meta.main) {
  try {
    const mod = await import('${githubUrl}');
    await mod.main();
  } catch (e) {
    if (e instanceof TypeError && e.message.includes('Module not found')) {
      console.error('Version not found: ${ref}');
      console.error('See available versions: https://github.com/wistrand/melker/tags');
      Deno.exit(1);
    }
    throw e;
  }
} else {
  console.error('This launcher can only be used as main entry point, not as a library import.');
}
`;

  return new Response(launcher, {
    headers: {
      'content-type': 'application/typescript',
      'cache-control': ref === 'main'
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    },
  });
};

export const config = {
  path: '/melker*.ts',
};
