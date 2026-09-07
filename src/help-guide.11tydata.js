// Data for src/help-guide.njk that frontmatter cannot express (#535): a
// computed value written as a template string is always a STRING, and
// `{% if noindex %}` in the layout is true of the string "false". So the flag
// comes from the page's own entry, where src/_data/help.js decided it: a
// guide the edition holds in English rather than its own language is written
// (a page must never go missing) but not offered to search — its English twin
// is the page to rank.
module.exports = {
  eleventyComputed: {
    noindex: data => !!(data.entry && data.entry.noindex),
  },
};
