/**
 * Generates docs/reference/index.html from CLAUDE.md's Documentation Index tables.
 *
 * Parses the markdown tables under "## Documentation Index" and generates
 * a styled HTML page with categorized doc links and a client-side markdown viewer.
 *
 * Run: deno run --allow-read --allow-write scripts/generate-reference-index.ts
 */

const claudeMd = await Deno.readTextFile('CLAUDE.md');

// Extract the Documentation Index section
const indexStart = claudeMd.indexOf('## Documentation Index');
const indexEnd = claudeMd.indexOf('\n## ', indexStart + 1);
const indexSection = claudeMd.substring(indexStart, indexEnd > 0 ? indexEnd : undefined);

// Parse sections: ### heading followed by markdown table rows
interface DocEntry { topic: string; path: string }
interface DocGroup { title: string; entries: DocEntry[] }

const groups: DocGroup[] = [];

// Add overview group for root-level docs
groups.push({
  title: 'Overview',
  entries: [
    { topic: 'CLAUDE.md (project guide)', path: 'CLAUDE.md' },
    { topic: 'README', path: 'README.md' },
    { topic: 'Manifesto', path: 'MANIFESTO.md' },
    { topic: 'FAQ', path: 'FAQ.md' },
  ]
});

const sectionRegex = /^### (.+)$/gm;
let match;
while ((match = sectionRegex.exec(indexSection)) !== null) {
  const title = match[1];
  const sectionStart = match.index + match[0].length;
  const nextSection = indexSection.indexOf('\n### ', sectionStart);
  const sectionText = indexSection.substring(sectionStart, nextSection > 0 ? nextSection : undefined);

  const entries: DocEntry[] = [];
  // Parse table rows: | topic | [name](path) |
  const rowRegex = /^\|\s*(.+?)\s*\|\s*\[.+?\]\((.+?)\)\s*\|$/gm;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(sectionText)) !== null) {
    const topic = rowMatch[1].trim();
    // Skip header separator rows
    if (topic.startsWith('-')) continue;
    const rawPath = rowMatch[2].trim();
    const path = rawPath;
    entries.push({ topic, path });
  }

  if (entries.length > 0) {
    groups.push({ title, entries });
  }
}

// Generate HTML
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateGroupHtml(group: DocGroup): string {
  const items = group.entries.map(e =>
    `        <li><a href="${escapeHtml(e.path)}">${escapeHtml(e.topic)}</a></li>`
  ).join('\n');
  return `    <div class="doc-group">
      <h2>${escapeHtml(group.title)}</h2>
      <ul>
${items}
      </ul>
    </div>`;
}

const groupsHtml = groups.map(generateGroupHtml).join('\n\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Melker Reference</title>
  <link rel="icon" type="image/png" href="../favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
      --border: #30363d;
      --text: #e6edf3;
      --text-secondary: #8b949e;
      --accent: #39d353;
      --accent-secondary: #2ea043;
      --code-bg: #1c2128;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      font-size: 16px;
    }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    nav {
      padding: 16px 0;
      border-bottom: 1px solid var(--border);
    }

    nav .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    nav .brand {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
      font-size: 1.1rem;
    }

    nav .links { display: flex; gap: 24px; font-size: 0.9rem; }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 0 24px;
    }

    .doc-index {
      padding: 48px 0;
    }

    .doc-index h1 {
      font-family: 'JetBrains Mono', monospace;
      font-size: 2rem;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .doc-index .subtitle {
      color: var(--text-secondary);
      margin-bottom: 32px;
    }

    .doc-group {
      margin-bottom: 32px;
    }

    .doc-group h2 {
      font-family: 'JetBrains Mono', monospace;
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--accent);
    }

    .doc-group ul {
      list-style: none;
      columns: 2;
      column-gap: 32px;
    }

    .doc-group li {
      padding: 4px 0;
      break-inside: avoid;
    }

    #content {
      padding: 48px 0 64px;
      display: none;
    }

    #content h1, #content h2, #content h3, #content h4 {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 600;
      margin-top: 32px;
      margin-bottom: 12px;
    }

    #content h1 { font-size: 1.8rem; margin-top: 0; }
    #content h2 { font-size: 1.4rem; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
    #content h3 { font-size: 1.1rem; }

    #content p { margin-bottom: 16px; }

    #content pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 16px;
      overflow-x: auto;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      line-height: 1.5;
      margin-bottom: 16px;
    }

    #content code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.9em;
    }

    #content p code, #content li code, #content td code {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 2px 6px;
    }

    #content ul, #content ol {
      margin-bottom: 16px;
      padding-left: 24px;
    }

    #content li { margin-bottom: 4px; }

    #content table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }

    #content th, #content td {
      padding: 8px 12px;
      text-align: left;
      border: 1px solid var(--border);
    }

    #content th {
      background: var(--bg-secondary);
      font-weight: 600;
    }

    #content blockquote {
      border-left: 3px solid var(--accent);
      padding: 8px 16px;
      margin-bottom: 16px;
      color: var(--text-secondary);
      background: var(--bg-secondary);
    }

    #content hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 32px 0;
    }

    #content img {
      max-width: 100%;
    }

    .back-link {
      display: inline-block;
      margin-bottom: 24px;
      font-size: 0.9rem;
      color: var(--text-secondary);
    }

    .back-link:hover { color: var(--accent); }

    .raw-link {
      float: right;
      font-size: 0.85rem;
      color: var(--text-secondary);
    }

    #error {
      padding: 48px 0;
      display: none;
      color: var(--text-secondary);
    }

    @media (max-width: 600px) {
      .doc-group ul { columns: 1; }
      #content h1 { font-size: 1.4rem; }
    }
  </style>
</head>
<body>

<nav>
  <div class="container">
    <a href="/" class="brand">melker</a>
    <div class="links">
      <a href="/">Home</a>
      <a href="/how-it-works.html">How it works</a>
      <a href="/tutorial.html">Tutorial</a>
    </div>
  </div>
</nav>

<div class="container" id="index">
  <div class="doc-index">
    <h1>Reference</h1>
    <p class="subtitle">Architecture docs, component guides, and internals.</p>

${groupsHtml}
  </div>
</div>

<div class="container" id="content"></div>

<div class="container" id="error">
  <h2>Document not found</h2>
  <p>The requested reference doc could not be loaded.</p>
  <p><a href="/reference/">Back to index</a></p>
</div>

<script>
(function() {
  var params = new URLSearchParams(window.location.search);
  var doc = params.get('doc');
  if (!doc) return;

  if (!/^[\\w\\-/]+$/.test(doc)) {
    document.getElementById('index').style.display = 'none';
    document.getElementById('error').style.display = 'block';
    return;
  }

  document.getElementById('index').style.display = 'none';

  fetch(doc + '.md')
    .then(function(res) {
      if (!res.ok) throw new Error(res.status);
      return res.text();
    })
    .then(function(md) {
      var content = document.getElementById('content');
      var heading = md.match(/^#\\s+(.+)/m);
      if (heading) document.title = heading[1] + ' - Melker Reference';

      content.innerHTML =
        '<a href="/reference/" class="back-link">Reference</a>' +
        '<a href="' + doc + '.md" class="raw-link">View raw</a>' +
        marked.parse(md);
      content.style.display = 'block';
    })
    .catch(function() {
      document.getElementById('error').style.display = 'block';
    });
})();
</script>

<script>
document.addEventListener('click', function(e) {
  var a = e.target.closest('a');
  if (!a) return;
  var href = a.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('?') || href.startsWith('#')) return;
  var m = href.match(/^(.+?\\.md)(#.*)?$/);
  if (!m) return;
  e.preventDefault();
  var currentDoc = new URLSearchParams(window.location.search).get('doc');
  var baseUrl = currentDoc
    ? new URL('/reference/' + currentDoc + '.md', window.location.origin)
    : new URL('/reference/', window.location.origin);
  var resolved = new URL(m[1], baseUrl);
  var path = resolved.pathname.replace(/^\\/reference\\//, '').replace(/\\.md$/, '');
  window.location.href = '?doc=' + path + (m[2] || '');
});
</script>

</body>
</html>
`;

await Deno.writeTextFile('docs/reference/index.html', html);
console.log('Generated docs/reference/index.html from CLAUDE.md');
