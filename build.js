#!/usr/bin/env node
'use strict';

// build.js — Generates the portfolio site from a Notion database.
// Node 18+ required (uses native fetch). Zero npm dependencies.
//
// Env vars required:
//   NOTION_TOKEN        — secret integration token from notion.so/my-integrations
//   NOTION_DATABASE_ID  — ID of your projects database (32-char hex from the URL)
//
// Notion database properties expected (all optional except Name):
//   Name        (title)        — project title
//   Company     (text)         — client / company
//   Tagline     (text)         — one-line summary shown on the index page
//   Year        (number)       — year completed
//   Tags        (multi-select) — disciplines, e.g. UX Research, Prototyping
//   URL         (url)          — external live link
//   Status      (select)       — only pages with "Published" are included

const fs   = require('fs');
const path = require('path');

const TOKEN = process.env.NOTION_TOKEN;
const DB_ID = (process.env.NOTION_DATABASE_ID || '').replace(/-/g, '');
const OUT   = '_site';

if (!TOKEN || !DB_ID) {
  console.error('Error: NOTION_TOKEN and NOTION_DATABASE_ID must be set.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Notion API helpers
// ---------------------------------------------------------------------------

async function notion(method, endpoint, body) {
  const res = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Notion API ${endpoint}: ${res.status} — ${await res.text()}`);
  }
  return res.json();
}

async function queryDatabase() {
  const pages = [];
  let cursor;
  do {
    const data = await notion('POST', `databases/${DB_ID}/query`, {
      filter: { property: 'Status', select: { equals: 'Published' } },
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      ...(cursor && { start_cursor: cursor }),
    });
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return pages;
}

async function getBlocks(blockId) {
  const blocks = [];
  let cursor;
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    const data = await notion('GET', `blocks/${blockId}/children?${params}`);
    blocks.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return blocks;
}

// ---------------------------------------------------------------------------
// Property extraction
// ---------------------------------------------------------------------------

function richText(rts = []) {
  return rts.map(rt => {
    let t = rt.plain_text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    if (rt.annotations.bold)          t = `<strong>${t}</strong>`;
    if (rt.annotations.italic)        t = `<em>${t}</em>`;
    if (rt.annotations.code)          t = `<code>${t}</code>`;
    if (rt.annotations.strikethrough) t = `<s>${t}</s>`;
    if (rt.href)                       t = `<a href="${rt.href}">${t}</a>`;
    return t;
  }).join('');
}

function plainText(rts = []) {
  return rts.map(r => r.plain_text).join('');
}

function prop(page, name) {
  const p = page.properties[name];
  if (!p) return '';
  switch (p.type) {
    case 'title':        return plainText(p.title);
    case 'rich_text':    return plainText(p.rich_text);
    case 'number':       return p.number != null ? String(p.number) : '';
    case 'select':       return p.select?.name ?? '';
    case 'multi_select': return p.multi_select.map(s => s.name).join(', ');
    case 'url':          return p.url ?? '';
    case 'date':         return p.date?.start ?? '';
    default:             return '';
  }
}

function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Block → HTML renderer
// ---------------------------------------------------------------------------

function renderBlocks(blocks) {
  const out = [];
  let i = 0;

  while (i < blocks.length) {
    const b    = blocks[i];
    const type = b.type;

    // Group consecutive list items into a single <ul> or <ol>
    if (type === 'bulleted_list_item') {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        items.push(`<li>${richText(blocks[i].bulleted_list_item.rich_text)}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (type === 'numbered_list_item') {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        items.push(`<li>${richText(blocks[i].numbered_list_item.rich_text)}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    switch (type) {
      case 'paragraph':
        const text = richText(b.paragraph.rich_text);
        if (text) out.push(`<p>${text}</p>`);
        break;
      case 'heading_1':
        out.push(`<h2>${richText(b.heading_1.rich_text)}</h2>`);
        break;
      case 'heading_2':
        out.push(`<h3>${richText(b.heading_2.rich_text)}</h3>`);
        break;
      case 'heading_3':
        out.push(`<h4>${richText(b.heading_3.rich_text)}</h4>`);
        break;
      case 'divider':
        out.push('<hr>');
        break;
      case 'quote':
        out.push(`<blockquote>${richText(b.quote.rich_text)}</blockquote>`);
        break;
      case 'callout':
        out.push(`<aside class="callout">${richText(b.callout.rich_text)}</aside>`);
        break;
      case 'code': {
        const code = b.code.rich_text.map(r => r.plain_text).join('')
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const lang = b.code.language || '';
        out.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${code}</code></pre>`);
        break;
      }
      case 'image': {
        const src     = b.image.type === 'external' ? b.image.external.url : b.image.file.url;
        const caption = b.image.caption?.length ? richText(b.image.caption) : '';
        out.push(`<figure><img src="${src}" alt="${caption}" loading="lazy">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`);
        break;
      }
      case 'video': {
        const src = b.video.type === 'external' ? b.video.external.url : '';
        if (src) out.push(`<p><a href="${src}">Watch video ↗</a></p>`);
        break;
      }
      case 'embed':
        if (b.embed?.url) out.push(`<p><a href="${b.embed.url}">${b.embed.url}</a></p>`);
        break;
      // Ignore unsupported block types silently
    }

    i++;
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Shared CSS (inline — no external stylesheet needed)
// ---------------------------------------------------------------------------

const CSS = `
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    font-feature-settings: 'cv05', 'cv08', 'ss01';
    max-width: 65ch;
    margin: 3rem auto;
    padding: 0 1rem;
    line-height: 1.65;
    font-size: 1.0625rem;
  }
  h1 { text-align: center; letter-spacing: -0.02em; }
  h2, h3, h4 { letter-spacing: -0.015em; }
  .skip-link { position: absolute; top: -4rem; left: 0; }
  .skip-link:focus { top: 0; }
  :focus-visible { outline: 3px solid; outline-offset: 3px; }
  a { display: inline-block; padding-block: 0.4rem; }
  blockquote {
    border-left: 3px solid currentColor;
    margin-inline-start: 0;
    padding-inline-start: 1.5rem;
    font-style: italic;
  }
  pre {
    overflow-x: auto;
    padding: 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 0.9em;
  }
  figure { margin-inline: 0; }
  figure img { max-width: 100%; display: block; }
  figcaption { font-size: 0.875em; opacity: 0.65; margin-top: 0.4rem; }
  .callout {
    border-left: 4px solid currentColor;
    padding: 0.75rem 1rem;
    margin-block: 1rem;
  }
  .meta { opacity: 0.65; font-size: 0.9375rem; }
  .tagline { font-style: italic; }
  @media (prefers-color-scheme: dark) {
    body { background: #0a0a0a; color: #f0f0f0; }
    a { color: #6ea8fe; }
    a:visited { color: #c58af9; }
    pre { border-color: #333; }
  }
`;

// ---------------------------------------------------------------------------
// HTML page generators
// ---------------------------------------------------------------------------

function indexPage(projects) {
  const year  = new Date().getFullYear();
  const items = projects.length
    ? projects.map(p => {
        const label = p.company ? `${p.title} &mdash; ${p.company}` : p.title;
        return `        <a href="projects/${p.slug}.html">${label}</a><br>`;
      }).join('\n')
    : '        <p>No projects published yet.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Henry Davis is a UX designer who creates clear, accessible digital products.">
  <title>Henry Davis &mdash; UX Designer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>${CSS}  </style>
</head>
<body>

  <a class="skip-link" href="#main">Skip to main content</a>

  <header>
    <h1>Henry Davis</h1>
    <p>UX Designer &mdash; <a href="mailto:henry@example.com">henry@example.com</a></p>
  </header>

  <hr>

  <main id="main">

    <p><em>I design digital products that are clear, accessible, and built for real people.</em></p>

    <hr>

    <nav aria-label="Selected work">
      <p>
${items}
      </p>
    </nav>

    <hr>

    <nav aria-label="Contact">
      <p>
        <a href="https://linkedin.com/in/henrydavis">linkedin.com/in/henrydavis</a><br>
        <a href="#">Resume (PDF)</a>
      </p>
    </nav>

  </main>

  <hr>

  <footer>
    <p><small>&copy; ${year} Henry Davis</small></p>
  </footer>

</body>
</html>`;
}

function projectPage({ title, company, year, tags, url, content }) {
  const metaParts = [company, year, tags].filter(Boolean);
  const pageYear  = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${title}${company ? ` — ${company}` : ''}">
  <title>${title} &mdash; Henry Davis</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>${CSS}  </style>
</head>
<body>

  <a class="skip-link" href="#main">Skip to main content</a>

  <header>
    <p><a href="../index.html">&larr; Henry Davis</a></p>
    <h1>${title}</h1>
    ${metaParts.length ? `<p class="meta">${metaParts.join(' &mdash; ')}</p>` : ''}
    ${url ? `<p><a href="${url}">View project ↗</a></p>` : ''}
  </header>

  <hr>

  <main id="main">
    ${content || '<p>No content yet.</p>'}
  </main>

  <hr>

  <footer>
    <p><small>&copy; ${pageYear} Henry Davis</small></p>
  </footer>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(path.join(OUT, 'projects'), { recursive: true });

  console.log('Fetching projects from Notion…');
  const pages = await queryDatabase();
  console.log(`Found ${pages.length} published project(s)`);

  const projects = [];

  for (const page of pages) {
    const title = prop(page, 'Name');
    if (!title) continue;

    const company = prop(page, 'Company');
    const year    = prop(page, 'Year');
    const tags    = prop(page, 'Tags');
    const url     = prop(page, 'URL');
    const s       = slug(title);

    console.log(`  Building: ${title}`);

    const blocks  = await getBlocks(page.id);
    const content = renderBlocks(blocks);
    const html    = projectPage({ title, company, year, tags, url, content });

    fs.writeFileSync(path.join(OUT, 'projects', `${s}.html`), html);
    projects.push({ title, company, slug: s });
  }

  fs.writeFileSync(path.join(OUT, 'index.html'), indexPage(projects));
  console.log(`Done — ${projects.length} project(s) → ${OUT}/`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
