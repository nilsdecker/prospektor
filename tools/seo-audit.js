// The SEO audit harness (#137). Asks PRODUCTION — or any origin given as
// AUDIT_SITE — for every URL in its own sitemap plus the pages deliberately
// kept out of it, and reports the on-page facts an SEO audit is made of:
// titles, descriptions, canonicals, heading structure, structured data,
// social cards, internal linking and page weight.
//
// It reports FACTS and flags DEFECTS. It deliberately does not compute a
// score: a score is a number nobody can act on, and #137's spec asks for a
// ranked fix list instead. Read-only, no keys, safe to run any time.
//
//   node tools/seo-audit.js              # human-readable report
//   node tools/seo-audit.js --json       # the same data, for a diff
const SITE = (process.env.AUDIT_SITE || 'https://prospektor.ai').replace(/\/$/, '');
// The origin the site canonicalises to, which is production even when SITE is
// a local build. Used to tell an internal link from an outbound one.
const CANONICAL = 'https://prospektor.ai';
const JSON_OUT = process.argv.includes('--json');

// Pages deliberately absent from the sitemap. Each is still audited, because
// "not in the sitemap" is not "not crawled" — Google reaches them from links.
const OFF_SITEMAP = ['/checkout/', '/checkout/done/', '/404.html'];

const get = async (url, tries = 3) => {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      const body = r.status >= 200 && r.status < 400 ? await r.text() : '';
      return { status: r.status, headers: r.headers, body, location: r.headers.get('location') };
    } catch (e) { lastErr = e; await new Promise(s => setTimeout(s, 400 * (i + 1))); }
  }
  throw lastErr;
};

const strip = s => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim();

const meta = (html, re) => { const m = html.match(re); return m ? strip(m[1]) : null; };

function parse(html, url) {
  const p = {};
  p.title = meta(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  p.titleLen = p.title ? p.title.length : 0;
  p.description = meta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || meta(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  p.descLen = p.description ? p.description.length : 0;
  p.canonical = (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i) || [])[1] || null;
  p.robots = meta(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i);
  p.lang = (html.match(/<html[^>]*\slang=["']([^"']*)["']/i) || [])[1] || null;
  p.viewport = !!html.match(/<meta[^>]+name=["']viewport["']/i);
  p.charset = !!html.match(/<meta[^>]+charset=/i);
  p.ogTitle = meta(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i);
  p.ogDesc = meta(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i);
  p.ogImage = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)["']/i) || [])[1] || null;
  p.ogType = meta(html, /<meta[^>]+property=["']og:type["'][^>]+content=["']([^"']*)["']/i);
  p.ogUrl = (html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']*)["']/i) || [])[1] || null;
  p.twCard = meta(html, /<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']*)["']/i);
  p.twImage = (html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']*)["']/i) || [])[1] || null;

  // Heading outline, in document order.
  p.headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map(m => ({ level: +m[1], text: strip(m[2]).slice(0, 120) }));
  p.h1s = p.headings.filter(h => h.level === 1).map(h => h.text);

  // Structured data.
  p.jsonld = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1].trim());
      for (const node of Array.isArray(v) ? v : [v]) {
        const graph = node['@graph'] ? node['@graph'] : [node];
        for (const g of graph) p.jsonld.push({ type: g['@type'], keys: Object.keys(g) });
      }
    } catch (e) { p.jsonld.push({ type: 'PARSE-ERROR', error: String(e.message).slice(0, 120) }); }
  }
  p.jsonldTypes = p.jsonld.map(j => Array.isArray(j.type) ? j.type.join('+') : j.type);

  // Links, split into internal / external / anchor.
  const hrefs = [...html.matchAll(/<a\b[^>]*\shref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m => ({ href: m[1], text: strip(m[2]).slice(0, 80) }));
  p.linksInternal = []; p.linksExternal = []; p.linksAnchor = [];
  for (const l of hrefs) {
    if (l.href.startsWith('#')) p.linksAnchor.push(l);
    else if (/^https?:\/\//i.test(l.href)) {
      const sameHost = [new URL(SITE).host, new URL(CANONICAL).host].includes(new URL(l.href).host);
      (sameHost ? p.linksInternal : p.linksExternal).push(l);
    } else if (l.href.startsWith('/')) p.linksInternal.push(l);
    else if (!/^(mailto|tel|javascript):/i.test(l.href)) p.linksInternal.push(l);
  }
  // Normalised set of internal destinations, for the link-graph pass.
  p.internalTargets = [...new Set(p.linksInternal.map(l =>
    /^https?:\/\//i.test(l.href) ? new URL(l.href).pathname
      : new URL(l.href, 'https://x' + url.replace(/^https?:\/\/[^/]+/, '')).pathname))];

  // Images: alt text and explicit dimensions (the CLS-relevant half).
  p.images = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => ({
    src: (m[0].match(/\ssrc=["']([^"']*)["']/i) || [])[1] || null,
    alt: (m[0].match(/\salt=["']([^"']*)["']/i) || [])[1] ?? null,
    hasDims: /\swidth=/i.test(m[0]) && /\sheight=/i.test(m[0]),
    loading: (m[0].match(/\sloading=["']([^"']*)["']/i) || [])[1] || null,
  }));

  // Weight and blocking resources.
  p.bytes = Buffer.byteLength(html);
  p.scripts = [...html.matchAll(/<script\b[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi)]
    .map(m => ({ src: m[1], async: /\sasync\b/i.test(m[0]), defer: /\sdefer\b/i.test(m[0]) }));
  p.stylesheets = [...html.matchAll(/<link\b[^>]*\srel=["']stylesheet["'][^>]*>/gi)]
    .map(m => (m[0].match(/\shref=["']([^"']*)["']/i) || [])[1]);
  // Everything the browser fetches before it can paint, so #169's cache
  // policy can be asked of the same list rather than of a hand-kept one.
  p.preloads = [...html.matchAll(/<link\b[^>]*\srel=["']preload["'][^>]*>/gi)]
    .map(m => (m[0].match(/\shref=["']([^"']*)["']/i) || [])[1]);
  p.inlineStyleBytes = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .reduce((n, m) => n + Buffer.byteLength(m[1]), 0);
  p.inlineScriptBytes = [...html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .reduce((n, m) => n + Buffer.byteLength(m[1]), 0);

  // Visible body text, as a proxy for "is there anything here to rank".
  const body = (html.match(/<body[\s\S]*<\/body>/i) || [''])[0]
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  p.words = strip(body).split(/\s+/).filter(Boolean).length;
  return p;
}

(async () => {
  const sm = await get(SITE + '/sitemap.xml');
  // The sitemap always names the canonical production origin, which is not
  // necessarily the origin being audited — pointing AUDIT_SITE at a local
  // build is how a change is checked before it ships. So the path is taken
  // from the URL rather than by stripping the site prefix off the front.
  const sitemapUrls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const sitemapPaths = sitemapUrls.map(u => new URL(u).pathname);
  const paths = [...sitemapPaths, ...OFF_SITEMAP];

  const pages = {};
  for (const path of paths) {
    const url = SITE + path;
    const r = await get(url);
    pages[path] = { url, status: r.status, inSitemap: sitemapPaths.includes(path),
      contentType: r.headers.get('content-type'), xRobots: r.headers.get('x-robots-tag'),
      ...(r.body ? parse(r.body, url) : {}) };
  }
  const out = { site: SITE, at: new Date().toISOString(), sitemapCount: sitemapUrls.length, pages };
  if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); return; }

  // ---- Human report ----
  const F = [];       // defects, each { sev, page, what }
  const flag = (sev, page, what) => F.push({ sev, page, what });

  const seenTitle = new Map(), seenDesc = new Map();
  for (const [path, p] of Object.entries(pages)) {
    if (p.status !== 200) { if (p.inSitemap) flag('BLOCKER', path, `sitemap URL answers ${p.status}`); continue; }
    const indexable = p.inSitemap && !/noindex/i.test(p.robots || '') && !/noindex/i.test(p.xRobots || '');
    if (!p.title) flag('BLOCKER', path, 'no <title>');
    else {
      if (p.titleLen > 60) flag('MAJOR', path, `title ${p.titleLen} chars — truncated in results (>60)`);
      if (p.titleLen < 15) flag('MAJOR', path, `title only ${p.titleLen} chars`);
      if (indexable) {
        if (seenTitle.has(p.title)) flag('MAJOR', path, `title duplicates ${seenTitle.get(p.title)}`);
        else seenTitle.set(p.title, path);
      }
    }
    if (!p.description) flag('MAJOR', path, 'no meta description');
    else {
      if (p.descLen > 160) flag('MINOR', path, `description ${p.descLen} chars — truncated (>160)`);
      if (p.descLen < 70) flag('MINOR', path, `description only ${p.descLen} chars — under-uses the snippet`);
      if (indexable) {
        if (seenDesc.has(p.description)) flag('MAJOR', path, `description duplicates ${seenDesc.get(p.description)}`);
        else seenDesc.set(p.description, path);
      }
    }
    if (!p.canonical) flag('MAJOR', path, 'no canonical');
    else if (new URL(p.canonical).pathname !== path) flag('BLOCKER', path, `canonical points elsewhere: ${p.canonical}`);
    if (!p.lang) flag('MINOR', path, 'no <html lang>');
    if (!p.viewport) flag('MAJOR', path, 'no viewport meta — mobile rendering');
    if (p.h1s.length === 0) flag('MAJOR', path, 'no <h1>');
    if (p.h1s.length > 1) flag('MINOR', path, `${p.h1s.length} <h1> elements`);
    // Heading order: a jump of more than one level down is a structure defect.
    let prev = 0;
    for (const h of p.headings) {
      if (prev && h.level > prev + 1) { flag('MINOR', path, `heading jumps h${prev} → h${h.level} ("${h.text.slice(0, 40)}")`); break; }
      prev = h.level;
    }
    if (!p.ogImage) flag('MINOR', path, 'no og:image');
    if (!p.twCard) flag('MINOR', path, 'no twitter:card');
    if (indexable && p.jsonldTypes.length === 0) flag('MAJOR', path, 'no structured data');
    if (p.jsonldTypes.includes('PARSE-ERROR')) flag('BLOCKER', path, 'structured data is not valid JSON');
    for (const im of p.images) if (im.alt === null) flag('MINOR', path, `img without alt: ${im.src}`);
    if (indexable && p.words < 250) flag('MAJOR', path, `only ${p.words} words of body copy`);
    // F6/R3: a <script src> with neither defer nor async stops the parser
    // where it sits, so nothing below it renders until it has been fetched
    // and run. #137 recorded async/defer as a fact per script and flagged no
    // defect — which is why F6 had to be read off the fact table by eye, and
    // why R3 could sit in a document rather than in a red suite. Since #170
    // `test/pages.test.js` pins the rule on the build, and this asks the same
    // of PRODUCTION, where a tag injected into the response — Netlify's own
    // RUM script — counts too.
    for (const s of p.scripts)
      if (!s.async && !s.defer) flag('MINOR', path, `parser-blocking script: ${s.src}`);
  }

  // Internal link graph: which indexable pages nothing links to.
  const inbound = {};
  for (const path of Object.keys(pages)) inbound[path] = new Set();
  for (const [from, p] of Object.entries(pages)) {
    for (const t of (p.internalTargets || [])) {
      const norm = t.endsWith('/') || t.includes('.') ? t : t + '/';
      if (inbound[norm] && from !== norm) inbound[norm].add(from);
    }
  }
  for (const [path, p] of Object.entries(pages)) {
    if (p.status === 200 && p.inSitemap && inbound[path].size === 0 && path !== '/')
      flag('MAJOR', path, 'orphan — no other audited page links to it');
  }

  // ── #169: the assets a page blocks on, and how they are cached ────────
  // The board row's cost was eight conditional round trips for a repeat
  // visitor — every asset answering `max-age=0, must-revalidate` because no
  // filename carried a content hash. Both halves of the fix are asked of
  // production here, and the second one is the dangerous direction: a long
  // `immutable` cache on a name with no hash serves a stale file for a year,
  // and no page-level check would ever see it.
  const HASHED_TREE = /^\/assets\/(?:css|js|fonts)\//;
  const HASHED_NAME = /\.[0-9a-f]{8,}\.(?:css|js|woff2)$/;
  const assetRefs = [...new Set(Object.values(pages).flatMap(p =>
    [...(p.stylesheets || []), ...(p.preloads || []), ...(p.scripts || []).map(x => x.src)]))]
    .filter(u => u && u.startsWith('/assets/'));
  const assetCache = {};
  for (const ref of assetRefs) {
    let r;
    try { r = await get(SITE + ref, 2); } catch (e) { flag('MAJOR', ref, `asset unreachable: ${e.message}`); continue; }
    const cc = r.headers.get('cache-control') || '';
    assetCache[ref] = { status: r.status, cc };
    if (r.status !== 200) { flag('BLOCKER', ref, `blocking asset answers ${r.status}`); continue; }
    const hashed = HASHED_NAME.test(ref);
    const immutable = /\bimmutable\b/.test(cc);
    const maxAge = Number((cc.match(/max-age=(\d+)/) || [])[1] || 0);
    if (immutable && !hashed)
      flag('BLOCKER', ref, `immutable cache on a filename with no content hash — a stale copy lives for a year (${cc})`);
    if (HASHED_TREE.test(ref) && !hashed)
      flag('MAJOR', ref, 'no content hash, so it can never be cached (#169)');
    if (hashed && (!immutable || maxAge < 2592000))
      flag('MAJOR', ref, `hashed but re-validated on every visit — the round trip #169 removed is back (${cc || 'no cache-control'})`);
  }

  const order = { BLOCKER: 0, MAJOR: 1, MINOR: 2 };
  F.sort((a, b) => order[a.sev] - order[b.sev] || a.page.localeCompare(b.page));

  console.log(`SEO audit — ${SITE} — ${out.at}`);
  console.log(`${Object.keys(pages).length} pages audited (${sitemapUrls.length} in the sitemap)\n`);
  console.log('PAGE'.padEnd(46), 'TTL', 'DESC', 'H1', 'WORDS', 'KB', 'SCHEMA');
  for (const [path, p] of Object.entries(pages)) {
    if (p.status !== 200) { console.log(path.padEnd(46), `HTTP ${p.status}`, p.location || ''); continue; }
    console.log(path.padEnd(46), String(p.titleLen).padStart(3), String(p.descLen).padStart(4),
      String(p.h1s.length).padStart(2), String(p.words).padStart(5),
      String(Math.round(p.bytes / 1024)).padStart(3), (p.jsonldTypes.join(',') || '—'));
  }
  console.log('\nBLOCKING ASSET'.padEnd(52), 'CACHE-CONTROL');
  for (const [ref, a] of Object.entries(assetCache))
    console.log(('  ' + ref).padEnd(52), a.status === 200 ? (a.cc || '—') : `HTTP ${a.status}`);
  console.log(`\n${F.length} findings\n`);
  for (const f of F) console.log(`  ${f.sev.padEnd(7)} ${f.page.padEnd(44)} ${f.what}`);
  const blockers = F.filter(f => f.sev === 'BLOCKER').length;
  console.log(`\n${blockers} blocker, ${F.filter(f => f.sev === 'MAJOR').length} major, ${F.filter(f => f.sev === 'MINOR').length} minor`);
  process.exitCode = blockers ? 1 : 0;
})();
