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

// Read one attribute off the first tag matching `tagRe` — the tag is found
// first, then the attribute is read out of it.
//
// Two steps rather than one regex, for two reasons #446 hit. **The delimiter is
// BACK-REFERENCED** (`(["'])(.*?)\\1`) instead of re-matched as a class: the
// obvious `content=["']([^"']*)["']`, which is what this file used until now,
// terminates the capture on the first quote of EITHER kind, so a single
// apostrophe inside a double-quoted value truncates it and the tool reports a
// healthy 155-character description as 30 characters and a MINOR that is not
// there. Nothing on this site triggers it today only because Nunjucks escapes
// `'` to `&#39;` inside an attribute — which is luck, not design: one `| safe`
// on a description would start this lying, and a measuring tool that lies
// quietly is worse than no tool.
//
// And it makes attribute ORDER stop mattering. `content=` before `name=` is
// valid HTML, and the one-regex spelling needed a second alternation to cope
// with it — which existed for `description` and for nothing else, so every
// other field was one hand-written attribute away from reading null.
const tagAttr = (html, tagRe, name) => {
  const tag = html.match(tagRe);
  if (!tag) return null;
  const m = tag[0].match(new RegExp(`\\s${name}=(["'])([\\s\\S]*?)\\1`, 'i'));
  return m ? strip(m[2]) : null;
};
const meta = (html, re) => { const m = html.match(re); return m ? strip(m[1]) : null; };

function parse(html, url) {
  const p = {};
  p.title = meta(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  p.titleLen = p.title ? p.title.length : 0;
  p.description = tagAttr(html, /<meta[^>]+name=["']description["'][^>]*>/i, 'content');
  p.descLen = p.description ? p.description.length : 0;
  p.canonical = tagAttr(html, /<link[^>]+rel=["']canonical["'][^>]*>/i, 'href');
  p.robots = tagAttr(html, /<meta[^>]+name=["']robots["'][^>]*>/i, 'content');
  p.lang = tagAttr(html, /<html[^>]*>/i, 'lang');
  p.viewport = !!html.match(/<meta[^>]+name=["']viewport["']/i);
  p.charset = !!html.match(/<meta[^>]+charset=/i);

  // Every tag inside <head> is TERMINATED. This is the first check in the
  // portable brief #446 was built from, and it is there because it is the one
  // that hides: a scripted head insert left `<link rel="canonical">` without
  // its `>` across 36 files, which swallowed everything after it in the head,
  // and nobody noticed for weeks. Nothing else here would catch it — an
  // unterminated tag does not break the page, it silently deletes the
  // canonical, the OG card and the JSON-LD from the document the crawler sees,
  // and every one of those checks below would then report "absent" and send
  // the reader off to add a tag that is already in the template.
  //
  // Comments and script/style bodies come out first: a `<` inside either is
  // text, not a tag, and JSON-LD is where this site keeps its longest strings.
  const headHtml = (html.match(/<head[\s\S]*?<\/head>/i) || [''])[0]
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  p.unterminated = [];
  for (let i = headHtml.indexOf('<'); i >= 0; i = headHtml.indexOf('<', i + 1)) {
    const gt = headHtml.indexOf('>', i), lt = headHtml.indexOf('<', i + 1);
    if (gt < 0 || (lt >= 0 && lt < gt)) {
      p.unterminated.push(headHtml.slice(i, i + 60).replace(/\s+/g, ' ').trim());
    }
  }
  p.ogTitle = tagAttr(html, /<meta[^>]+property=["']og:title["'][^>]*>/i, 'content');
  p.ogDesc = tagAttr(html, /<meta[^>]+property=["']og:description["'][^>]*>/i, 'content');
  p.ogImage = tagAttr(html, /<meta[^>]+property=["']og:image["'][^>]*>/i, 'content');
  p.ogType = tagAttr(html, /<meta[^>]+property=["']og:type["'][^>]*>/i, 'content');
  p.ogUrl = tagAttr(html, /<meta[^>]+property=["']og:url["'][^>]*>/i, 'content');
  p.twCard = tagAttr(html, /<meta[^>]+name=["']twitter:card["'][^>]*>/i, 'content');
  p.twImage = tagAttr(html, /<meta[^>]+name=["']twitter:image["'][^>]*>/i, 'content');

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
    src: (m[0].match(/\ssrc=(["'])([\s\S]*?)\1/i) || [])[2] || null,
    alt: (m[0].match(/\salt=(["'])([\s\S]*?)\1/i) || [])[2] ?? null,
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

// Library plus CLI, the same shape as `tools/learning-coverage.js` and for the
// same reason: the parsing this tool does is worth pinning in `npm test`, and a
// module that audits production the moment it is required cannot be imported by
// a test at all. Requiring this file now gives you `parse`; running it audits.
module.exports = { parse, tagAttr, strip };

if (require.main !== module) return;

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
    for (const t of p.unterminated) {
      flag('BLOCKER', path, `unterminated tag in <head> — everything after it is swallowed: ${t}`);
    }
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
