/* The help corpus, turned into a page — and into a search index (#145/#136).

   This file is loaded twice, deliberately:

     - by the Eleventy build (`src/_data/help.js` requires it), which renders
       the corpus into the served HTML so a crawler is handed ten guides of
       real text instead of the word "Loading…" (#136);
     - by the browser (`/assets/js/help-render.js`, before help.js), which
       re-renders from the live corpus when the studio has moved on since the
       last build.

   Both callers therefore run the same renderer over the same markdown, which
   is what makes the "no double render" check cheap: if the corpus the browser
   fetches hashes to the same value the build stamped into the page, the DOM is
   already correct and nothing is touched at all.

   No dependencies, ES5, no modules — it has to run in the browser as a classic
   script and under `require` in Node without a build step between. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HelpRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STUDIO = 'https://studio.prospektor.ai';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /* `08-workspace.md` → `workspace`. The number is ordering, not identity. */
  function slugOf(name) {
    return String(name).replace(/^\d+-/, '').replace(/\.md$/, '');
  }

  function titleOf(md) {
    var m = md.match(/^#\s+(.*)$/m);
    return m ? m[1] : '';
  }

  /* Studio-relative links in the docs (/library, /settings) point at the
     product, not at this site — send them to the studio, in a new tab. */
  function href(url) {
    var abs = url.charAt(0) === '/' ? STUDIO + url : url;
    return '<a href="' + abs + '" target="_blank" rel="noopener">';
  }

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, function (_, code) { return '<code>' + code + '</code>'; })
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, text, url) { return href(url) + text + '</a>'; })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  /* ── markdown → HTML, sized to what the corpus actually uses:
     h1–h3, flat and one-level-nested lists (- and 1.), tables, and
     bold / italic / inline code / links inside any of them. Everything is
     HTML-escaped first; the corpus is our own docs, but the renderer
     should not have to trust that. */
  function render(md, slug) {
    var lines = md.split('\n');
    var out = [];
    var headings = [];
    var i = 0;

    function listAt(indent) {
      var items = []; // { text: raw markdown, sub: rendered nested list HTML }
      var ordered = null;
      while (i < lines.length) {
        var m = lines[i].match(/^(\s*)(?:([-*])|(\d+)\.)\s+(.*)$/);
        if (m && m[1].length === indent) {
          items.push({ text: m[4], sub: '' });
          if (ordered === null) ordered = !!m[3];
          i++;
          // continuation lines and one nested list belong to this item
          while (i < lines.length) {
            var next = lines[i];
            var nm = next.match(/^(\s*)(?:[-*]|\d+\.)\s+/);
            if (nm && nm[1].length > indent) {
              items[items.length - 1].sub += listAt(nm[1].length);
            } else if (next.match(/^\s+\S/) && !nm) {
              items[items.length - 1].text += ' ' + next.trim();
              i++;
            } else break;
          }
        } else break;
      }
      var tag = ordered ? 'ol' : 'ul';
      return '<' + tag + '>' + items.map(function (it) {
        return '<li>' + inline(esc(it.text)) + it.sub + '</li>';
      }).join('') + '</' + tag + '>';
    }

    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }

      var h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        var level = h[1].length;
        var text = h[2];
        var id = slug + '--' + slugify(text);
        if (level > 1) headings.push({ id: id, text: text });
        // The guide's own <h1> is rendered by the page, not here: on a hub
        // that stacks every guide there must be exactly one h1 on the
        // document, and it is the page's question.
        var tag = level === 1 ? 'h2' : 'h' + level;
        out.push('<' + tag + ' id="' + id + '">' + inline(esc(text)) + '</' + tag + '>');
        i++; continue;
      }

      if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
        var indent = line.match(/^(\s*)/)[1].length;
        out.push(listAt(indent));
        continue;
      }

      if (line.indexOf('|') === 0 && lines[i + 1] && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
        var cells = function (row) {
          return row.replace(/^\||\|\s*$/g, '').split('|').map(function (c) { return inline(esc(c.trim())); });
        };
        var head = cells(line);
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') === 0) { rows.push(cells(lines[i])); i++; }
        out.push('<div class="help-table-wrap"><table><thead><tr>' +
          head.map(function (c) { return '<th>' + c + '</th>'; }).join('') +
          '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
          '</tbody></table></div>');
        continue;
      }

      // paragraph: consume until a blank line or a structural line
      var para = [line.trim()];
      i++;
      while (i < lines.length && lines[i].trim() &&
             !/^#{1,3}\s|^\s*(?:[-*]|\d+\.)\s+|^\|/.test(lines[i])) {
        para.push(lines[i].trim());
        i++;
      }
      out.push('<p>' + inline(esc(para.join(' '))) + '</p>');
    }

    return { html: out.join('\n'), headings: headings };
  }

  /* ── plain text, for the index and for snippets. Markdown syntax in a
     snippet reads as noise, and nobody searches for "**". ── */

  function plainText(md) {
    var headings = []; // { pos: offset in the plain string, text }
    var parts = [];
    var length = 0;
    md.split('\n').forEach(function (line) {
      if (/^\|[\s:|-]+\|?\s*$/.test(line)) return; // table separator row
      var h = line.match(/^(#{1,3})\s+(.*)$/);
      var text = line;
      if (h) text = h[2];
      if (text.indexOf('|') === 0) {
        text = text.replace(/^\||\|\s*$/g, '').split('|').map(function (c) { return c.trim(); }).join(' · ');
      }
      text = text
        .replace(/^\s*(?:[-*]|\d+\.)\s+/, '')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1')
        .trim();
      if (h && h[1].length > 1) headings.push({ pos: length, text: text });
      parts.push(text);
      length += text.length + 1; // the joining '\n'
    });
    // A bold span can cross a line break (**none of the\n  research**), which
    // the per-line pass cannot see — sweep the leftover markers. Heading
    // offsets drift a couple of characters past such a span, which is well
    // inside what "the nearest heading above" tolerates.
    return { text: parts.join('\n').replace(/\*\*/g, ''), headings: headings };
  }

  /* One line of description for a card: the guide's first real paragraph,
     cut at a word boundary. Derived rather than authored, so a guide added
     in the studio gets a card without anyone editing this repo. */
  function dekFor(md) {
    // A list marker is a dash/star/number followed by a space. "**Share this
    // pitch** on a finished pitch's Summary…" is a paragraph, not a bullet,
    // and reading it as one skipped to the third line of 04-sharing.md and
    // put "mints a short /p/<token> link." on the card.
    var isHeading = function (l) { return /^#{1,3}\s/.test(l); };
    var isBullet = function (l) { return /^([-*]|\d+\.)\s/.test(l); };
    var lines = md.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || isHeading(line) || line.charAt(0) === '|') continue;

      // The first block of prose, whatever shape it arrives in. Some guides
      // open with a paragraph and some (10-troubleshooting) open straight
      // into a list, so a bullet is taken as the opening sentence rather than
      // skipped — skipping it landed the card on a continuation line reading
      // "the plumbing ran but nothing was researched."
      var para = [line.replace(/^([-*]|\d+\.)\s+/, '')];
      for (var j = i + 1; j < lines.length; j++) {
        var next = lines[j].trim();
        if (!next || isHeading(next) || isBullet(next) || next.charAt(0) === '|') break;
        para.push(next);
      }
      var text = plainText(para.join(' ')).text;
      if (text.length <= 116) return text;
      var cut = text.slice(0, 116);
      var space = cut.lastIndexOf(' ');
      return (space > 40 ? cut.slice(0, space) : cut).replace(/[,;:.]+$/, '') + '…';
    }
    return '';
  }

  /* ── the card face of each guide ──
     Emoji and category are presentation, so they live here rather than in the
     corpus: the studio's docs should not have to know what this site's hub
     looks like. An unknown slug still gets a card — that is the point of the
     default, because the studio can add a guide at any time and the hub is
     supposed to show it. */
  var CARDS = {
    'getting-started': { emoji: '🚀', topic: 'Start here' },
    'screens':         { emoji: '🧭', topic: 'The basics' },
    'pitches':         { emoji: '✍️', topic: 'Pitches' },
    'sharing':         { emoji: '🔗', topic: 'Pitches' },
    'network':         { emoji: '🤝', topic: 'Your network' },
    'calls':           { emoji: '📞', topic: 'Calls' },
    'outcomes':        { emoji: '📈', topic: 'Results' },
    'workspace':       { emoji: '⚙️', topic: 'Workspace & billing' },
    'best-practices':  { emoji: '💡', topic: 'Getting better' },
    'troubleshooting': { emoji: '🛠️', topic: 'Troubleshooting' },
    'privacy':         { emoji: '🔒', topic: 'Privacy' },
  };
  var DEFAULT_CARD = { emoji: '📄', topic: 'Guide' };

  function cardFor(slug) { return CARDS[slug] || DEFAULT_CARD; }

  /* ── the index ──
     One shape, whether it came from the JSON embedded at build time or from
     the live fetch. Everything the page and the search need is on it. */
  function buildIndex(files) {
    return (files || []).map(function (file) {
      var slug = slugOf(file.name);
      var title = titleOf(file.text) || slug;
      var rendered = render(file.text, slug);
      var plain = plainText(file.text);
      var card = cardFor(slug);
      // plainText() knows where each heading sits in the plain string but not
      // what it is called in the DOM, so the anchor is stamped on here — it
      // has to be the id render() put on the <h2>/<h3>, or "jump to the
      // nearest heading above the match" lands on #undefined and the reader
      // is dropped at the top of a 21k-character guide instead of at the
      // paragraph that answers them.
      plain.headings.forEach(function (h) { h.id = slug + '--' + slugify(h.text); });
      return {
        slug: slug,
        name: file.name,
        title: title,
        dek: dekFor(file.text),
        emoji: card.emoji,
        topic: card.topic,
        html: rendered.html,
        headings: rendered.headings,
        plain: plain.text,
        plainHeadings: plain.headings,
      };
    });
  }

  /* A cheap, stable fingerprint of the corpus (FNV-1a over name + text).
     Node and the browser must agree on it exactly — it is the whole
     "did anything actually change?" test, and therefore the whole reason the
     page does not re-render itself a second time for nothing. */
  function corpusHash(files) {
    var h = 0x811c9dc5;
    var joined = (files || []).map(function (f) { return f.name + ' ' + f.text; }).join('');
    for (var i = 0; i < joined.length; i++) {
      h ^= joined.charCodeAt(i) & 0xff;
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      // charCodeAt can exceed a byte; fold the high half in so a change up
      // there is not invisible.
      h ^= (joined.charCodeAt(i) >> 8) & 0xff;
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  /* ── search ──
     The bug this replaces: the whole query was matched as one substring
     (`lower.indexOf(q)`), so "client workspace" found the section and
     "how can I create a new workspace" — the operator's actual question,
     which the corpus does answer — found nothing at all.

     Now: split the query, drop the words that carry no signal, stem the rest,
     require every remaining term to appear somewhere in the article, and rank
     title > heading > body. */

  var STOP = ('a an and any are as at be been but by can cant could did do does doing dont for from '
    + 'get got had has have how i id if ill im in into is it its ive just me my of on or our shall '
    + 'should so than that the their them then there these they this those to us was we were what '
    + 'when where which who whom why will with would you your yours').split(' ');
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = true; });

  /* Conservative English stemming — plurals and the -ing/-ed pair, nothing
     clever. It exists so "workspaces" finds "workspace" and "sharing" finds
     "shared", not to be a linguistics project. */
  function stem(w) {
    if (w.length <= 3) return w;
    if (/ies$/.test(w) && w.length > 4) w = w.slice(0, -3) + 'y';
    else if (/(sses|shes|ches|xes|zes)$/.test(w)) w = w.slice(0, -2);
    else if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
    if (/(ing|ed)$/.test(w) && w.length > 5) {
      w = w.replace(/(ing|ed)$/, '');
      if (/(bb|dd|gg|mm|nn|pp|rr|tt)$/.test(w)) w = w.slice(0, -1); // stopped → stop
    }
    // "revoke" and "revoked" have to land on the same string, and after the
    // step above they are "revoke" and "revok".
    if (w.length > 4 && /e$/.test(w)) w = w.slice(0, -1);
    return w;
  }

  function words(s) {
    return String(s).toLowerCase().match(/[a-z0-9]+/g) || [];
  }

  /* The query, as terms worth scoring. If a question is *entirely* stop-words
     ("how do i…") the stop list is dropped rather than the query — an empty
     term list would fall back to "nothing matches", which is the failure this
     whole function exists to remove. */
  function terms(query) {
    var all = words(query);
    var kept = all.filter(function (w) { return !STOPSET[w] && w.length > 1; });
    var chosen = kept.length ? kept : all;
    var seen = {};
    var out = [];
    chosen.forEach(function (w) {
      var s = stem(w);
      if (s && !seen[s]) { seen[s] = true; out.push({ word: w, stem: s }); }
    });
    return out;
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Every place a term occurs, as {pos, len}. Matching is on a word prefix:
     the stem "workspac" matches "workspace" and "workspaces" where a bare
     substring search would also match nothing useful in the other direction. */
  function occurrences(text, term) {
    var re = new RegExp('\\b' + escapeRe(term.stem) + '[a-z0-9]*', 'gi');
    var hits = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      hits.push({ pos: m.index, len: m[0].length });
      if (hits.length > 200) break;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return hits;
  }

  function headingAbove(article, pos) {
    var best = null;
    for (var k = 0; k < article.plainHeadings.length; k++) {
      if (article.plainHeadings[k].pos > pos) break;
      best = article.plainHeadings[k];
    }
    return best;
  }

  var TITLE_WEIGHT = 10;
  var HEADING_WEIGHT = 4;
  var BODY_WEIGHT = 1;
  var BODY_CAP = 5;         // a word repeated forty times is not forty times better
  var PHRASE_BONUS = 25;    // the exact question, verbatim, in the text
  var CLUSTER_BONUS = 12;   // every term inside one window — the right section
  var CLUSTER_WINDOW = 240;

  function scoreArticle(article, qterms, rawQuery) {
    var titleWords = {};
    words(article.title).forEach(function (w) { titleWords[stem(w)] = true; });

    var headingText = article.plainHeadings.map(function (h) { return h.text; }).join('\n');
    var headingWords = {};
    words(headingText).forEach(function (w) { headingWords[stem(w)] = true; });

    var lower = article.plain.toLowerCase();
    var score = 0;
    var matched = 0;
    var all = [];

    for (var i = 0; i < qterms.length; i++) {
      var t = qterms[i];
      var inTitle = !!titleWords[t.stem];
      var inHeading = !!headingWords[t.stem];
      var occ = occurrences(lower, t);
      if (!inTitle && !inHeading && !occ.length) continue;

      matched++;
      if (inTitle) score += TITLE_WEIGHT;
      if (inHeading) score += HEADING_WEIGHT;
      score += Math.min(occ.length, BODY_CAP) * BODY_WEIGHT;
      occ.forEach(function (o) { all.push({ pos: o.pos, len: o.len, term: t.stem }); });
    }

    if (!matched) return null;

    var q = String(rawQuery).trim().toLowerCase();
    if (q.length > 2 && lower.indexOf(q) > -1) score += PHRASE_BONUS;

    all.sort(function (a, b) { return a.pos - b.pos; });

    // The best window — the place where the most of the question is being
    // answered at once. This is what makes "how can I create a new workspace"
    // land on the section about creating one rather than on the first page
    // that happens to say "workspace".
    //
    // Distinct terms decide it, then the section heading, then tightness. The
    // heading term matters because this window also chooses the anchor the
    // reader is thrown to: "delete my workspace" should arrive at *Billing,
    // pausing, deleting*, not at the first paragraph that says "workspace".
    var best = [];
    var bestTerms = 0;
    var bestRank = -Infinity;
    for (var s = 0; s < all.length; s++) {
      var seen = {};
      var n = 0;
      var window = [];
      for (var e = s; e < all.length && all[e].pos - all[s].pos <= CLUSTER_WINDOW; e++) {
        if (!seen[all[e].term]) { seen[all[e].term] = true; n++; }
        window.push(all[e]);
      }
      var span = window.length ? window[window.length - 1].pos - window[0].pos : 0;
      var head = headingAbove(article, all[s].pos);
      var headHit = false;
      if (head) {
        var hw = {};
        words(head.text).forEach(function (w) { hw[stem(w)] = true; });
        headHit = qterms.some(function (t) { return hw[t.stem]; });
      }
      var rank = n * 1000 + (headHit ? 400 : 0) - span;
      if (rank > bestRank) { bestRank = rank; bestTerms = n; best = window; }
    }
    if (bestTerms >= qterms.length && qterms.length > 1) score += CLUSTER_BONUS;

    return { score: score, matched: matched, occurrences: all, best: best, bestTerms: bestTerms };
  }

  function snippetAt(article, pos, len) {
    var text = article.plain;
    var start = Math.max(0, pos - 60);
    var end = Math.min(text.length, pos + len + 90);
    return {
      before: (start > 0 ? '…' : '') + text.slice(start, pos),
      match: text.slice(pos, pos + len),
      after: text.slice(pos + len, end) + (end < text.length ? '…' : ''),
    };
  }

  /* Up to three places per article, well apart — three snippets of the same
     sentence tell the reader less than three places. */
  function snippetsFor(article, scored, limit) {
    var chosen = [];
    var pool = (scored.best && scored.best.length ? scored.best : []).concat(scored.occurrences);
    var used = [];
    for (var i = 0; i < pool.length && chosen.length < (limit || 3); i++) {
      var o = pool[i];
      var tooClose = used.some(function (p) { return Math.abs(p - o.pos) < 120; });
      if (tooClose) continue;
      used.push(o.pos);
      var head = headingAbove(article, o.pos);
      chosen.push({
        snippet: snippetAt(article, o.pos, o.len),
        heading: head ? head.text : null,
        anchor: head ? head.id : article.slug,
      });
    }
    return chosen;
  }

  /* Returns [{ article, score, matched, snippets }], best first. */
  function search(articles, query, options) {
    var opts = options || {};
    var qterms = terms(query);
    if (!qterms.length) return [];

    var scored = [];
    for (var i = 0; i < (articles || []).length; i++) {
      var a = articles[i];
      var s = scoreArticle(a, qterms, query);
      if (s) scored.push({ article: a, s: s });
    }
    if (!scored.length) return [];

    // Every meaningful term must appear somewhere in the article — that is the
    // precision the old whole-string match had and the reason it was worth
    // keeping. When nothing clears that bar, fall back to the articles that
    // match the most terms rather than reporting "nothing matches": a partial
    // answer beats a dead end, and the dead end is the bug on this row.
    var full = scored.filter(function (r) { return r.s.matched === qterms.length; });
    var kept = full.length ? full : (function () {
      var best = Math.max.apply(null, scored.map(function (r) { return r.s.matched; }));
      return scored.filter(function (r) { return r.s.matched === best; });
    })();

    kept.sort(function (x, y) {
      return (y.s.matched - x.s.matched) || (y.s.score - x.s.score) ||
        x.article.title.localeCompare(y.article.title);
    });

    return kept.map(function (r) {
      return {
        article: r.article,
        score: r.s.score,
        matched: r.s.matched,
        terms: qterms.length,
        partial: !full.length,
        snippets: snippetsFor(r.article, r.s, opts.snippets || 3),
      };
    });
  }

  return {
    STUDIO: STUDIO,
    esc: esc,
    slugify: slugify,
    slugOf: slugOf,
    titleOf: titleOf,
    render: render,
    plainText: plainText,
    dekFor: dekFor,
    cardFor: cardFor,
    buildIndex: buildIndex,
    corpusHash: corpusHash,
    search: search,
    terms: terms,
    stem: stem,
  };
});
