#!/usr/bin/env node
/**
 * build-article-worklist.js — one-off prep for the bulk article generation workflow.
 *
 * Walks J:/articles/articles_catalog.json, maps every category node (all 5 levels)
 * to its on-disk folder (J:/articles/<slug-chain>), and:
 *   - writes a tiny `_meta.json` into each existing folder with the writer's context
 *     ({ name, breadcrumb, rationale, level, articleUrl, fileName })
 *   - builds a master worklist of folder paths that still need an article.md
 *
 * Outputs:
 *   J:/articles/_worklist_paths.json   — array of folder paths needing an article
 *   prints a summary (total nodes, on-disk, missing, already-done, to-write)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = 'J:/articles';
const CATALOG = path.join(BASE, 'articles_catalog.json');
const ARTICLE_FILE = 'article.md';          // fixed name (Windows MAX_PATH safety on deep slugs)

const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));

let totalNodes = 0, onDisk = 0, missing = 0, alreadyDone = 0, toWrite = 0;
const missingSamples = [];
const worklist = [];

function rationaleOf(node) {
  return (node.rationale || node.description || '').toString().trim();
}

function walk(node, slugChain, nameChain, level) {
  // node has slug + name at every level; top-level roots too.
  const slug = node.slug;
  if (!slug) return;
  const dirRel = [...slugChain, slug].join('/');
  const dirAbs = `${BASE}/${dirRel}`;
  const names = [...nameChain, node.name];
  totalNodes++;

  if (fs.existsSync(dirAbs) && fs.statSync(dirAbs).isDirectory()) {
    onDisk++;
    const articleUrl = `https://jubileeverse.com/articles/${dirRel}`;
    const meta = {
      name: node.name,
      slug,
      level,
      breadcrumb: names.join(' > '),
      rationale: rationaleOf(node),
      tier: node.tier || null,
      score: node.score || null,
      articleUrl,
      fileName: ARTICLE_FILE,
    };
    try { fs.writeFileSync(path.join(dirAbs, '_meta.json'), JSON.stringify(meta, null, 2)); } catch (e) {}

    // Does this folder already have a written article? (article.md, or any non-meta .md)
    const existing = fs.readdirSync(dirAbs).filter((f) => f.toLowerCase().endsWith('.md'));
    if (existing.length > 0) { alreadyDone++; }
    else { worklist.push(dirAbs); toWrite++; }
  } else {
    missing++;
    if (missingSamples.length < 15) missingSamples.push(dirRel);
  }

  const kids = node.subcategories || [];
  for (const k of kids) walk(k, [...slugChain, slug], names, level + 1);
}

for (const root of cat.categories) walk(root, [], [], 1);

fs.writeFileSync(path.join(BASE, '_worklist_paths.json'), JSON.stringify(worklist, null, 0));

console.log('================ BULK ARTICLE WORKLIST ================');
console.log(`catalog nodes (all levels): ${totalNodes}`);
console.log(`folders found on disk:      ${onDisk}`);
console.log(`folders MISSING on disk:    ${missing}`);
console.log(`already have an article:    ${alreadyDone}`);
console.log(`>> TO WRITE (worklist):     ${toWrite}`);
if (missingSamples.length) {
  console.log('--- sample missing folder paths (catalog slug -> no disk dir) ---');
  missingSamples.forEach((m) => console.log('   ' + m));
}
console.log(`worklist written: ${path.join(BASE, '_worklist_paths.json')}`);
console.log('=======================================================');
