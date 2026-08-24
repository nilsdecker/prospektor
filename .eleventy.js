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

  // Everything in the collection except the page you are on, newest first,
  // capped. Compared by url because the collection entry and the `page` object
  // inside a layout are not the same object.
  eleventyConfig.addFilter("related", (collection, url, n) =>
    (collection || [])
      .filter(item => item.url !== url)
      .sort((a, b) => toDate(b.data.date) - toDate(a.data.date))
      .slice(0, n || 3));

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
