const assets = require("./lib/assets.js");
const i18n = require("./lib/i18n.js");

module.exports = function(eleventyConfig) {
  // ── The funnel in more than one language (#114) ──────────────────────
  // `lib/i18n.js` is the mechanism; this block is only its Nunjucks face.
  // Every page knows its language from its URL (`/es/…` is Spanish, the rest
  // is English), so nothing here takes a language argument: `{% t %}…{% endt %}`
  // around a sentence renders it in the language of the page it is on, and
  // renders it UNTOUCHED — the same bytes — on an English page. A sentence a
  // catalogue lacks renders in English and is logged once, never thrown:
  // untranslated is reported, not red, the way #113 and #131 both decided.
  eleventyConfig.on("eleventy.before", () => { i18n.reload(); known = null; });
  const missed = new Set();
  // The sentences the site itself says, read once per build. A miss is logged
  // only for one of these: a value that arrives from somewhere else — a help
  // guide's title, which the studio already serves in the page's language
  // (#535) — is looked up like any other and falls back without a word,
  // because "no translation" is not a defect of a catalogue that was never
  // meant to hold it.
  let known = null;
  const knows = key => {
    if (!known) known = new Set(i18n.inventory().map(e => e.key));
    return known.has(i18n.normalizeKey(key));
  };
  const say = (key, code) => {
    if (!knows(key)) return;
    const id = code + '\0' + key;
    if (missed.has(id)) return;
    missed.add(id);
    console.warn(`[i18n] ${code}: no translation for ${JSON.stringify(i18n.normalizeKey(key).slice(0, 80))}`);
  };
  // this.page is the page being rendered — inside a layout too — since 2.0.
  const langHere = function() { return i18n.localeOf(this.page && this.page.url); };

  eleventyConfig.addPairedShortcode("t", function(content) {
    const code = langHere.call(this);
    if (code === i18n.DEFAULT) return content;
    const hit = i18n.translate(content, code);
    // A miss renders the English, with its links still localized: the page
    // is Spanish whether or not this sentence is yet.
    if (hit === undefined) { say(content, code); return localizeLinks.call(this, content); }
    // The block's own whitespace survives around the translation, so the
    // markup around it keeps its shape whichever language is rendering.
    // A link inside a sentence is written English-side (`href="/pricing/"`)
    // and localized here on the way out, exactly as `| localize` would —
    // written as an expression inside the block it would render differently
    // on every page and never match its key (#535).
    return content.match(/^\s*/)[0] + localizeLinks.call(this, hit) + content.match(/\s*$/)[0];
  });
  // The same for a value — a frontmatter title, a site.json label. `vars`
  // fills `{placeholder}`s in whichever sentence wins (#535: the help pages
  // name the language a guide is not yet in); without them English is still
  // returned untouched, before any lookup.
  eleventyConfig.addFilter("t", function(value, vars) {
    const code = langHere.call(this);
    if (value == null) return value;
    if (code === i18n.DEFAULT) return vars ? i18n.fill(value, vars) : value;
    const hit = i18n.translate(String(value), code, vars);
    if (hit === undefined) { say(String(value), code); return vars ? i18n.fill(value, vars) : value; }
    // A plain string on purpose: it is autoescaped exactly as the English
    // value would have been, so `{{ description | t }}` inside an attribute
    // is safe in every language for the same reason it was in one.
    return hit;
  });

  // The language of the page being rendered, as its LANGUAGES entry.
  eleventyConfig.addFilter("localeOf", url => i18n.LANGUAGES.find(l => l.code === i18n.localeOf(url)));

  // An internal href, in the language of the page it is on — when that page
  // exists. `/pricing/` on a Spanish page is `/es/pricing/` if the build wrote
  // one and `/pricing/` if it did not, which is what keeps a link from ever
  // pointing at a URL the build did not produce. Derived from the build's own
  // page list, never from a list of translated pages kept by hand.
  const urls = function() {
    const all = (this.ctx && this.ctx.collections && this.ctx.collections.all) || [];
    return new Set(all.map(p => p.url));
  };
  const localize = function(href) {
    const code = langHere.call(this);
    if (code === i18n.DEFAULT) return href;
    const want = i18n.twin(href, code);
    const pathOnly = want.replace(/[#?].*$/, '');
    return urls.call(this).has(pathOnly) ? want : href;
  };
  eleventyConfig.addFilter("localize", localize);
  // Every internal href in a fragment of markup, localized the same way.
  const localizeLinks = function(html) {
    return String(html).replace(/href="(\/[^"]*)"/g, (m, href) =>
      href.startsWith('/assets/') ? m : `href="${localize.call(this, href)}"`);
  };

  // Every language a page exists in — `[{ code, own, url, current }]` — for
  // the hreflang links, the footer switcher and the sitemap. A page with no
  // twin answers a list of one, and the layout then writes no hreflang at
  // all: it is meaningless without a second language (SEO-AUDIT.md R5).
  eleventyConfig.addFilter("alternates", function(url) {
    const have = urls.call(this);
    const here = i18n.localeOf(url);
    return i18n.built()
      .map(l => ({ code: l.code, own: l.own, og: l.og, url: i18n.twin(url, l.code), current: l.code === here }))
      .filter(a => have.has(a.url));
  });

  // What the browser needs, as JSON for the page's <script type="application/json">:
  // the page's own client strings (only the ones a script asks for, only when
  // the catalogue has them) plus, on an ENGLISH page only, the one line the
  // language nudge says in each other language to a visitor whose browser
  // prefers it (#544). A translated page was chosen — by a click, a link or a
  // typed URL — and is never nudged, so it carries nothing to nudge with.
  eleventyConfig.addFilter("i18nPayload", function(url) {
    const code = i18n.localeOf(url);
    const payload = { lang: code, strings: i18n.clientStrings(code) || {} };
    if (code === 'en') payload.suggest = i18n.suggestStrings();
    return JSON.stringify(payload);
  });

  // The languages this build writes, for pagination: `src/_data/locales.js`
  // reads the same list, and a template paginates over it to get one page per
  // language. Also handy where a template wants to know whether there is more
  // than one at all.
  eleventyConfig.addGlobalData("languages", () => i18n.built());

  // ── Content-hashed assets (#169) ──────────────────────────────────────
  // Assets are NOT passthrough-copied any more: css, js and fonts are served
  // under a filename carrying a hash of their bytes, so `netlify.toml` can
  // answer `immutable` for them and a repeat visitor stops paying eight
  // conditional round trips before anything renders. `lib/assets.js` explains
  // where the line between hashed and verbatim is drawn, and why.
  //
  // The manifest is rebuilt on every run rather than once at config load, so
  // `eleventy --serve` picks up an edited stylesheet without a restart.
  let built = assets.build();
  eleventyConfig.on("eleventy.before", () => { built = assets.build(); });
  // The output directory is taken from what Eleventy just WROTE, not from
  // `dir.output`: `--output=<dir>` sets Eleventy's own `rawOutput` and leaves
  // the config's `dir.output` saying `_site`, so trusting it would write every
  // asset into the repo while the tests built into a temp directory — a suite
  // that passes locally and ships a site with no stylesheet.
  eleventyConfig.on("eleventy.after", (ev) => assets.emit(assets.outputRoot(ev), built));
  eleventyConfig.addWatchTarget("src/assets/");

  // Every asset reference in a template goes through this — including the ones
  // that are served verbatim, which resolve to themselves. That is the point:
  // a path this build does not produce throws here, at build time, instead of
  // 404ing in a browser. A missing Open Graph card is a blank card everywhere
  // a link is shared, and nothing else on the page would have noticed.
  eleventyConfig.addFilter("asset", url => {
    const served = built.manifest.get(url);
    if (!served) throw new Error(`asset: nothing built at ${url} — check src${url}`);
    return served;
  });

  // ── /resources/ (#144) ────────────────────────────────────────────────
  // Three filters rather than clever template expressions. Nunjucks has no
  // dependable `limit`, and `{% set %}` inside a `{% for %}` does not survive
  // the iteration — so the "related articles" pick is done here, in JS, where
  // it can be read and tested instead of guessed at.

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];

  // Frontmatter dates arrive as a Date (Eleventy parses `date:`); a string is
  // accepted too so an article can carry `updated: 2026-08-24` as plain text.
  const toDate = v => (v instanceof Date ? v : new Date(v));

  eleventyConfig.addFilter("isoDate", v => toDate(v).toISOString().slice(0, 10));

  eleventyConfig.addFilter("readableDate", v => {
    const d = toDate(v);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  });

  // The "Keep reading" block at the foot of every article.
  //
  // This used to be "everything else, newest first, capped at 3" — which is
  // not related, it is *recent*, and #137's audit measured what that costs.
  // Every article linked to the same three newest articles, so inbound
  // internal links ran 9, 9, 9, 4, 1, 1, 1, 1, 1: five of the nine articles
  // were reachable from the hub and nowhere else, which is the link graph
  // telling Google they are the least important pages on the site. They are
  // not — they are the same nine articles.
  //
  // So the pick is a RING, not a sort: articles are put in a stable order and
  // each one links to the `n` that follow it, wrapping around. That makes the
  // inbound count exactly `n` for every article, by construction and not by
  // luck — a tenth article changes nobody else's count. Within the three it
  // picks, a same-topic article is listed first, so the most relevant link is
  // also the first one a reader sees. Ordering inside the window cannot change
  // which articles were picked, so the evenness survives it.
  //
  // Compared by url because the collection entry and the `page` object inside
  // a layout are not the same object.
  eleventyConfig.addFilter("related", (collection, url, n) => {
    const all = (collection || []).slice()
      .sort((a, b) => toDate(b.data.date) - toDate(a.data.date) || a.url.localeCompare(b.url));
    const i = all.findIndex(item => item.url === url);
    if (i < 0) return all.slice(0, n || 3);
    const take = Math.min(n || 3, all.length - 1);
    const picked = [];
    for (let k = 1; k <= take; k++) picked.push(all[(i + k) % all.length]);
    const topic = all[i].data.topic;
    return picked.sort((a, b) =>
      (b.data.topic === topic) - (a.data.topic === topic));
  });

  // The <title> budget. Google renders roughly 60 characters before it
  // truncates, and what it drops is the tail — so a 37-character brand suffix
  // on a 71-character headline is not branding, it is a guarantee that the
  // brand never appears and the headline is cut instead. #137 measured nine
  // article titles at 74-110 characters, every one of them truncated.
  //
  // So the suffix is fitted to what is left rather than always costing the
  // same: the full "— Prospektor · Your AI pre-sales team" when it fits,
  // "— Prospektor" when it does not, and the headline alone when even that
  // would push it further past the line. A page whose own headline is too
  // long for the budget sets `seoTitle` in its frontmatter — that changes the
  // search result only, never the <h1> a reader sees.
  const TITLE_BUDGET = 60;
  eleventyConfig.addFilter("metaTitle", (title, name, tagline) => {
    if (!title) return `${name} · ${tagline}`;
    const full = `${title} — ${name} · ${tagline}`;
    if (full.length <= TITLE_BUDGET) return full;
    const short = `${title} — ${name}`;
    if (short.length <= TITLE_BUDGET) return short;
    return title;
  });

  // ── /help/<slug>/ (#166) ──────────────────────────────────────────────
  // The same ring as `related` above, over the help corpus rather than over an
  // Eleventy collection: the guides are plain objects from src/_data/help.js,
  // they have no dates to sort by, and their order is the corpus's own (the
  // `01-`/`08-` prefixes the studio numbers its docs with), which is already
  // the reading order.
  //
  // A ring rather than "the first three" for exactly #137's reason: any
  // fixed-list pick leaves the guides at the end of the corpus reachable from
  // the hub and nowhere else, and inbound internal links are how Google reads
  // which pages of a section matter. Following-n-wrapping gives every guide
  // exactly n, by construction — a twelfth guide changes nobody else's count.
  eleventyConfig.addFilter("ring", (guides, slug, n) => {
    const all = guides || [];
    const i = all.findIndex(g => g.slug === slug);
    if (i < 0) return all.slice(0, n || 3);
    const take = Math.min(n || 3, all.length - 1);
    const picked = [];
    for (let k = 1; k <= take; k++) picked.push(all[(i + k) % all.length]);
    return picked;
  });

  // The topics present in a collection, with counts, alphabetical. Drives the
  // hub's filter row, so the row is derived from the articles rather than being
  // a hand-kept list that goes stale the first time somebody adds a topic.
  eleventyConfig.addFilter("topics", collection => {
    const counts = new Map();
    for (const item of collection || []) {
      const t = item.data.topic || "lead generation";
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => a.topic.localeCompare(b.topic));
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data"
    },
    templateFormats: ["njk", "html", "md"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};
