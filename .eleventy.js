module.exports = function(eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addWatchTarget("src/assets/");

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
