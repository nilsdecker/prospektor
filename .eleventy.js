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

  const byDateDesc = (a, b) => toDate(b.data.date) - toDate(a.data.date);

  // Everything in the collection except the page you are on, capped — same
  // topic first, then everything else, newest within each group. Compared by
  // url because the collection entry and the `page` object inside a layout are
  // not the same object.
  //
  // Newest-first alone was fine at nine articles and stops meaning anything as
  // the section grows (#159): every article's "keep reading" block showed the
  // same three most recent posts, so the pricing article recommended the cold
  // email article to everybody. The hub passes an empty url, which matches no
  // entry, so there is no current topic and the hub keeps its pure newest-first
  // order — the one thing its own test asserts.
  eleventyConfig.addFilter("related", (collection, url, n) => {
    const all = (collection || []).filter(item => item.url !== url);
    const here = (collection || []).find(item => item.url === url);
    const topic = here && here.data.topic;
    if (!topic) return all.sort(byDateDesc).slice(0, n || 3);
    const same = all.filter(i => i.data.topic === topic).sort(byDateDesc);
    const rest = all.filter(i => i.data.topic !== topic).sort(byDateDesc);
    return same.concat(rest).slice(0, n || 3);
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
