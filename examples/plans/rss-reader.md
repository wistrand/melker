# Plan: RSS Reader Showcase App

## RSS Library: @mikaelporttila/rss

Deno-native, available on JSR, zero dependencies. Supports RSS 1.0/2.0 and Atom.

```typescript
import { parseFeed } from "jsr:@mikaelporttila/rss";

const response = await fetch(url);
const xml = await response.text();
const feed = await parseFeed(xml);
// feed.title, feed.description, feed.feedType
// feed.entries[].id, .title, .description, .content, .published, .links, .categories
```

## Default Feeds

| Feed | URL | Why |
|------|-----|-----|
| Hacker News | `https://news.ycombinator.com/rss` | Fast, reliable, always fresh |
| BBC News | `https://feeds.bbci.co.uk/news/rss.xml` | Well-structured, international |
| Ars Technica | `https://feeds.arstechnica.com/arstechnica/index` | Longer descriptions, tech focus |

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│  RSS Reader              [feed selector v]        Updated HH:MM │
├────────────────────────────┬─────────────────────────────────┤
│  data-table                │  markdown                       │
│  ───────────────────────── │                                 │
│  Title        Source  Age  │  ## Article Title                │
│ >Big Story    BBC     2h   │                                 │
│  New Thing    HN      4h   │  Published: 2026-02-23 14:30    │
│  Tech News    Ars     5h   │  Source: BBC News                │
│  Another...   HN      6h   │                                 │
│  ...                       │  Article description/content     │
│                            │  rendered as markdown...         │
│                            │                                 │
│                            │  [Open in browser]              │
├────────────────────────────┴─────────────────────────────────┤
│  Tab: navigate | Enter: read | R: refresh | A: add feed       │
└──────────────────────────────────────────────────────────────┘
```

## Components

| Component | Purpose |
|-----------|---------|
| `split-pane` | Left (article list) / right (reader) panels |
| `data-table` | Sortable article list with columns: Title, Source, Age |
| `markdown` | Render article description/content with word wrap |
| `select` | Feed picker dropdown (switch between feeds) |
| `command` | Global shortcuts: R=refresh, A=add feed |
| `text` | Header, footer, status text |
| `spinner` | Loading indicator during fetch |
| `dialog` | "Add feed" dialog with an `input` for custom URL |

## Implementation Phases

### Phase 1: Skeleton + Single Feed

Minimal working app: markup, policy, one feed (Hacker News), fetch + parse + display.

- [x] `<melker>` boilerplate: `<title>`, `<policy>`, `<help>`, `<style>`
- [x] Layout markup: header (`text`), `split-pane`, `data-table`, reader placeholder, footer
- [x] Sync `<script>`: types (`FeedSource`, `Article`), state vars, `timeAgo()` helper
- [x] `fetchFeed(url)` -- fetch XML, `parseFeed()`, map entries to `Article[]`
- [x] `updateUI()` -- push rows to `data-table`, set footer count
- [x] `async="ready"` script: fetch Hacker News, `updateUI()`, render
- [x] Fix Age column sorting -- replaced with "Time" column using sortable "MM-DD HH:MM" format;
  relative time shown in tooltip. Added `sortColumn="2"` `sortDirection="desc"` `tooltip="auto"`
  and `onTooltip` handler with title, source, relative time, and description preview
- [ ] Verify it launches and shows articles

### Phase 2: Article Reader

Select a row, display content in the right-side markdown panel.

- [x] `onChange` handler on `data-table` -- set `selectedArticle`, update markdown panel
- [x] `onActivate` handler -- same as onChange (Enter key)
- [x] Markdown panel shows: title as `##`, published date, source name, description/content
- [x] Empty state text when no article selected ("Select an article to read")
- [x] `onTooltip` handler on `data-table` -- show article description preview on hover
- [x] `htmlToMarkdown(html)` helper -- convert basic HTML from feed descriptions to markdown
  - `<a href>` to `[text](url)`, `<b>`/`<strong>` to `**`, `<i>`/`<em>` to `*`
  - `<br>` / `<p>` to newlines, `<ul>`/`<ol>`/`<li>` to markdown lists
  - `<img>` to `![alt](src)`, `<code>` / `<pre>` to backticks
  - Strip remaining tags, decode `&amp;` `&lt;` `&gt;` `&quot;` entities

### Phase 3: Multi-Feed

Add BBC and Ars Technica. Aggregate, sort, filter by source.

- [x] Add all 3 feeds to `FEEDS` array and `<policy>` net list
- [x] `refresh()` uses `Promise.allSettled` -- fetch all feeds, merge + sort by date descending
- [x] `select` dropdown: "All Feeds", "Hacker News", "BBC News", "Ars Technica"
- [x] `changeFeed()` handler -- filter `displayedArticles` by source (or show all)
- [x] Per-feed error isolation: catch per fetch, toast on failure, continue with others

### Phase 4: Polish

Auto-refresh, keyboard shortcuts, add-feed dialog, loading states.

- [x] Auto-refresh: `setInterval` every 5 minutes, toast on new articles
- [x] `command` elements: R=refresh, A=add feed dialog
- [x] Add-feed dialog: `input` for URL, validate + fetch on confirm, add to feed list + select dropdown
- [x] Loading `spinner` in header, toggles during fetch
- [x] Status text: article count, last update time

## Script Architecture

```
<script> (sync)           -- Types, state vars, helper functions
  - FeedSource[] array, Article[] array, selectedArticle, activeFilter
  - fetchFeed(url) -- fetch + parseFeed + map to Article[]
  - refreshAll() -- Promise.all across feeds, merge + sort
  - updateUI() -- push rows to data-table, update markdown reader
  - timeAgo(date) -- relative time formatter ("2h ago", "3d ago")

<script async="ready">   -- Initial load
  - await refreshAll()
  - updateUI(), render
  - Start auto-refresh interval (5 min)
```

## Policy

Since RSS feeds come from arbitrary domains, the policy block lists each feed host:

```xml
<policy>
{ "permissions": { "net": [
  "news.ycombinator.com",
  "feeds.bbci.co.uk",
  "feeds.arstechnica.com"
] } }
</policy>
```

Adding a custom feed would require the user to also allow that domain (Melker prompts for unrecognized network hosts).

## Reference

- Earthquake dashboard (`examples/showcase/earthquake-dashboard.melker`) -- canonical pattern for fetch + data-table + split-pane + auto-refresh
- npm import demo (`examples/melker/npm-import-demo.melker`) -- shows external module imports

## Sources

- [@mikaelporttila/rss on JSR](https://jsr.io/@mikaelporttila/rss)
- [@mikaelporttila/rss on GitHub](https://github.com/MikaelPorttila/rss)
- [feedsmith on GitHub](https://github.com/macieklamberski/feedsmith)
- [rss-parser on npm](https://www.npmjs.com/package/rss-parser)
- [hnrss.org](https://hnrss.org/)
