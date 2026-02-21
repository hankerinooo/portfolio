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
  // Recursively fetch children for blocks that have them
  for (const block of blocks) {
    if (block.has_children) {
      block._children = await getBlocks(block.id);
    }
  }
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
        const bl = blocks[i];
        const nested = bl._children ? renderBlocks(bl._children) : '';
        items.push(`<li>${richText(bl.bulleted_list_item.rich_text)}${nested}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (type === 'numbered_list_item') {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'numbered_list_item') {
        const bl = blocks[i];
        const nested = bl._children ? renderBlocks(bl._children) : '';
        items.push(`<li>${richText(bl.numbered_list_item.rich_text)}${nested}</li>`);
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
  :root {
    --bg: #FAF8F5;
    --ink: #1C1917;
    --ink-faint: rgba(28,25,23,0.1);
    --ink-mid: rgba(28,25,23,0.5);
  }
  @media (prefers-color-scheme: dark) {
    html:not([data-theme="light"]) {
      --bg: #1A1612;
      --ink: #EDE8E0;
      --ink-faint: rgba(237,232,224,0.1);
      --ink-mid: rgba(237,232,224,0.5);
    }
  }
  html[data-theme="dark"] {
    --bg: #1A1612;
    --ink: #EDE8E0;
    --ink-faint: rgba(237,232,224,0.1);
    --ink-mid: rgba(237,232,224,0.5);
  }
  html { scroll-behavior: smooth; }
  body {
    font-family: 'Jost', system-ui, sans-serif;
    background: var(--bg);
    color: var(--ink);
    max-width: 720px;
    margin: 0 auto;
    padding: 4rem 2rem 5rem;
    line-height: 1.65;
    font-size: 1.0625rem;
  }
  h1, h2, h3, h4 {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 400;
    font-optical-sizing: auto;
    line-height: 1.1;
    letter-spacing: -0.025em;
  }
  h1 { font-size: clamp(3.5rem, 10vw, 6rem); margin-top: 0; margin-bottom: 0.5rem; text-rendering: optimizeLegibility; font-kerning: normal; letter-spacing: -0.03em; }
  h2 { font-size: 2.25rem; margin-top: 3rem; margin-bottom: 0.5rem; }
  h3 { font-size: 1.625rem; margin-top: 2.25rem; margin-bottom: 0.25rem; }
  h4 { font-size: 1.25rem; margin-top: 1.75rem; margin-bottom: 0.25rem; }
  .skip-link { position: absolute; top: -4rem; left: 0; }
  .skip-link:focus { top: 0; }
  :focus-visible { outline: 3px solid var(--ink); outline-offset: 3px; }
  a { color: var(--ink); }
  a:visited { color: var(--ink); }
  hr { border: none; border-top: 1px solid var(--ink-faint); margin: 3rem 0; }
  header + hr { margin-top: 2rem; }
  main + hr { margin-bottom: 1.5rem; }
  header > p:first-child { margin-top: 0; margin-bottom: 2.5rem; font-size: 0.875rem; }
  footer p { margin: 0; }
  blockquote {
    margin-inline: 0;
    padding-inline-start: 1.5rem;
    border-left: 2px solid var(--ink-faint);
    font-style: italic;
    opacity: 0.75;
  }
  pre {
    overflow-x: auto;
    padding: 1.25rem;
    border: 1px solid var(--ink-faint);
    font-size: 0.875em;
    background: transparent;
  }
  figure { margin-inline: 0; margin-block: 2.5rem; }
  figure img { max-width: 100%; display: block; }
  figcaption { font-size: 0.875em; opacity: 0.55; margin-top: 0.5rem; }
  .callout { padding: 1rem 0; font-style: italic; opacity: 0.8; }
  .meta { opacity: 0.5; font-size: 0.875rem; letter-spacing: 0.05em; text-transform: uppercase; font-weight: 500; }
  .tagline { font-style: italic; font-size: 1.125rem; opacity: 0.8; }
  nav[aria-label="Selected work"] a {
    font-family: 'Fraunces', Georgia, serif;
    font-optical-sizing: auto;
    font-size: clamp(1.5rem, 4vw, 2.25rem);
    font-weight: 400;
    line-height: 1.2;
    letter-spacing: -0.02em;
    text-decoration: none;
    color: var(--ink);
    display: block;
    transition: opacity 0.15s;
  }
  nav[aria-label="Selected work"] a:visited { color: var(--ink); }
  nav[aria-label="Selected work"] a:hover { opacity: 0.6; }
  .project-list { list-style: none; margin: 0; padding: 0; }
  .project-list li { padding-block: 0.875rem; }
  .project-tagline { margin: 0.2rem 0 0; opacity: 0.65; }
  .project-tags { margin: 0.2rem 0 0; font-size: 0.8125rem; opacity: 0.5; letter-spacing: 0.05em; text-transform: uppercase; font-weight: 500; }
  .section-tag {
    font-family: 'Jost', system-ui, sans-serif;
    font-size: 0.875rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    opacity: 0.5;
    margin-top: 2.5rem;
    margin-bottom: 0;
  }
  .tag-section:first-child .section-tag { margin-top: 0; }
  .intro { font-style: italic; opacity: 0.8; margin: 0.5rem 0 2rem; }
  .copy-email, .dl-resume {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    color: inherit;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    vertical-align: middle;
  }
  .copy-email:hover, .dl-resume:hover { text-decoration: underline; }
  .copy-email .icon-check { display: none; }
  .copy-email.copied .icon-copy { display: none; }
  .copy-email.copied .icon-check { display: inline; }
  .header-actions { display: flex; gap: 1.5rem; flex-wrap: wrap; }
  .theme-toggle {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    background: transparent;
    border: 1px solid var(--ink-mid);
    border-radius: 2rem;
    padding: 0.55rem 1rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
    cursor: pointer;
    color: var(--ink);
    z-index: 200;
    opacity: 0.4;
    transition: opacity 0.15s;
  }
  .theme-toggle:hover { opacity: 1; }
  .tt-sun { display: none; }
  @media (prefers-color-scheme: dark) {
    html:not([data-theme="light"]) .tt-sun { display: inline; }
    html:not([data-theme="light"]) .tt-moon { display: none; }
  }
  html[data-theme="dark"] .tt-sun { display: inline; }
  html[data-theme="dark"] .tt-moon { display: none; }
  @media (max-width: 640px) {
    body { padding: 1.75rem 1.25rem 2.5rem; }
    hr { margin: 1.75rem 0; }
    header + hr { margin-top: 1.25rem; }
    .project-list li { padding-block: 0.5rem; }
  }
  .page-nav { display: none; }
  @media (min-width: 1200px) {
    .page-nav {
      display: block;
      position: fixed;
      top: 3rem;
      left: calc(50% + 22rem);
      width: 12rem;
      font-size: 0.8rem;
      line-height: 1.45;
    }
    .page-nav-title {
      display: block;
      font-size: 0.625rem;
      font-weight: 500;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      opacity: 0.4;
      margin-bottom: 0.75rem;
      padding-left: 0.75rem;
    }
    .page-nav a {
      display: block;
      padding: 0.2rem 0 0.2rem 0.75rem;
      text-decoration: none;
      color: var(--ink);
      opacity: 0.45;
      border-left: 2px solid transparent;
      transition: opacity 0.15s;
    }
    .page-nav a:visited { color: var(--ink); }
    .page-nav a:hover { opacity: 0.85; }
    .page-nav a.active {
      opacity: 1;
      border-left-color: var(--ink);
      font-weight: 500;
    }
    .page-nav .nav-h3 { padding-left: 1.5rem; font-size: 0.75rem; }
  }
`;

// ---------------------------------------------------------------------------
// HTML page generators
// ---------------------------------------------------------------------------

function indexPage(projects) {
  const year = new Date().getFullYear();

  // Group projects by tag, preserving first-seen order
  const tagOrder = [];
  const tagMap   = new Map();
  const untagged = [];

  for (const p of projects) {
    const arr = p.tagsArray || [];
    if (arr.length === 0) {
      untagged.push(p);
    } else {
      for (const tag of arr) {
        if (!tagMap.has(tag)) {
          tagOrder.push(tag);
          tagMap.set(tag, []);
        }
        tagMap.get(tag).push(p);
      }
    }
  }

  function renderItem(p) {
    const label       = p.company ? `${p.title} &mdash; ${p.company}` : p.title;
    const taglineHtml = p.tagline ? `\n          <p class="project-tagline">${p.tagline}</p>` : '';
    return `        <li>\n          <a href="projects/${p.slug}.html">${label}</a>${taglineHtml}\n        </li>`;
  }

  let workHtml;
  if (projects.length === 0) {
    workHtml = '<p>No projects published yet.</p>';
  } else if (tagOrder.length === 0) {
    // No tags — flat list
    workHtml = `<ul class="project-list">\n${projects.map(renderItem).join('\n')}\n      </ul>`;
  } else {
    const sections = tagOrder.map(tag => {
      const ps = tagMap.get(tag);
      return `<section class="tag-section">
        <h2 class="section-tag">${tag}</h2>
        <ul class="project-list">
${ps.map(renderItem).join('\n')}
        </ul>
      </section>`;
    });
    if (untagged.length > 0) {
      sections.push(`<section class="tag-section">
        <h2 class="section-tag">Other</h2>
        <ul class="project-list">
${untagged.map(renderItem).join('\n')}
        </ul>
      </section>`);
    }
    workHtml = sections.join('\n      ');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Henry Davis — Design portfolio">
  <title>Henry Davis &mdash; Design portfolio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;1,9..144,400&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
  <style>${CSS}  </style>
  <script>(function(){var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);})();</script>
</head>
<body>

  <a class="skip-link" href="#main">Skip to main content</a>

  <header>
    <h1>Henry Davis</h1>
    <p class="meta">Design portfolio</p>
    <p class="meta header-actions"><button class="copy-email" aria-label="Copy email address"><svg class="icon-copy" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg class="icon-check" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg><span class="copy-label">COPY EMAIL</span></button><a class="dl-resume" href="resume.pdf" download aria-label="Download resume as PDF"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>RESUME</span></a></p>
  </header>

  <hr>

  <main id="main">

    <nav aria-label="Selected work">
      ${workHtml}
    </nav>

  </main>

  <hr>

  <footer>
    <p><small>&copy; ${year} Henry Davis</small></p>
  </footer>

  <button class="theme-toggle" id="theme-toggle" aria-label="Switch to dark mode"><svg class="tt-moon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg><svg class="tt-sun" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg><svg class="tt-swap" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3L4 7l4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/></svg></button>
  <script>
    (function(){
      var root=document.documentElement,btn=document.getElementById('theme-toggle');
      function update(){
        var dark=root.getAttribute('data-theme')==='dark'||
          (!root.getAttribute('data-theme')&&window.matchMedia('(prefers-color-scheme: dark)').matches);
        btn.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
      }
      update();
      btn.addEventListener('click',function(){
        var cur=root.getAttribute('data-theme')||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
        var next=cur==='dark'?'light':'dark';
        root.setAttribute('data-theme',next);
        localStorage.setItem('theme',next);
        update();
      });
    })();
    (function(){
      var eb=document.querySelector('.copy-email');
      if(!eb)return;
      eb.addEventListener('click',function(){
        navigator.clipboard.writeText('davish52@gmail.com').then(function(){
          eb.classList.add('copied');
          eb.querySelector('.copy-label').textContent='COPIED';
          setTimeout(function(){
            eb.classList.remove('copied');
            eb.querySelector('.copy-label').textContent='COPY EMAIL';
          },2000);
        });
      });
    })();
  </script>

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
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;1,9..144,400&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
  <style>${CSS}  </style>
  <script>(function(){var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);})();</script>
</head>
<body>

  <a class="skip-link" href="#main">Skip to main content</a>

  <header>
    <p><a href="../index.html">&larr; Henry Davis</a></p>
    <h1>${title}</h1>
    ${metaParts.length ? `<p class="meta">${metaParts.join(' &mdash; ')}</p>` : ''}
    ${url ? `<p><a href="${url}">View project ↗</a></p>` : ''}
  </header>

  <nav id="page-nav" class="page-nav" aria-label="On this page">
    <span class="page-nav-title">On this page</span>
  </nav>

  <hr>

  <main id="main">
    ${content || '<p>No content yet.</p>'}
  </main>

  <hr>

  <footer>
    <p><small>&copy; ${pageYear} Henry Davis</small></p>
  </footer>

  <button class="theme-toggle" id="theme-toggle" aria-label="Switch to dark mode"><svg class="tt-moon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg><svg class="tt-sun" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg><svg class="tt-swap" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3L4 7l4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/></svg></button>
  <script>
    (function(){
      // Theme toggle
      var root=document.documentElement,btn=document.getElementById('theme-toggle');
      function update(){
        var dark=root.getAttribute('data-theme')==='dark'||
          (!root.getAttribute('data-theme')&&window.matchMedia('(prefers-color-scheme: dark)').matches);
        btn.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
      }
      update();
      btn.addEventListener('click',function(){
        var cur=root.getAttribute('data-theme')||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
        var next=cur==='dark'?'light':'dark';
        root.setAttribute('data-theme',next);
        localStorage.setItem('theme',next);
        update();
      });

      // In-page nav
      var nav=document.getElementById('page-nav');
      if(nav){
        var hs=Array.prototype.slice.call(document.querySelectorAll('#main h2,#main h3'));
        if(hs.length<2){
          nav.style.display='none';
        } else {
          hs.forEach(function(h,i){
            if(!h.id)h.id='s'+i;
            var a=document.createElement('a');
            a.href='#'+h.id;
            a.textContent=h.textContent;
            if(h.tagName==='H3')a.className='nav-h3';
            nav.appendChild(a);
          });
          var links=nav.querySelectorAll('a');
          links[0].classList.add('active');
          hs.forEach(function(h){
            new IntersectionObserver(function(entries){
              if(entries[0].isIntersecting){
                links.forEach(function(l){l.classList.remove('active');});
                var a=nav.querySelector('a[href="#'+h.id+'"]');
                if(a)a.classList.add('active');
              }
            },{rootMargin:'0px 0px -65% 0px'}).observe(h);
          });
        }
      }
    })();
  </script>

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

    const company   = prop(page, 'Company');
    const year      = prop(page, 'Year');
    const tagsArray = (page.properties['Tags']?.multi_select ?? []).map(s => s.name);
    const tags      = tagsArray.join(', ');
    const tagline   = prop(page, 'Tagline');
    const url       = prop(page, 'URL');
    const s         = slug(title);

    console.log(`  Building: ${title}`);

    const blocks  = await getBlocks(page.id);
    const content = renderBlocks(blocks);
    const html    = projectPage({ title, company, year, tags, url, content });

    fs.writeFileSync(path.join(OUT, 'projects', `${s}.html`), html);
    projects.push({ title, company, tagline, tags, tagsArray, slug: s });
  }

  fs.writeFileSync(path.join(OUT, 'index.html'), indexPage(projects));
  console.log(`Done — ${projects.length} project(s) → ${OUT}/`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
