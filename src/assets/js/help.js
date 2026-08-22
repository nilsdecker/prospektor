/* The help center (#76). The guides are not in this repo: they are the
   studio's docs/help corpus, served by the studio deploy itself at
   /api/help — fetched here at load time, so the moment a studio deploy
   updates its docs this page says the new thing, no rebuild in between.
   Rendering and search both happen in the browser: the corpus is ten small
   markdown files, an index is cheaper than a service. */
(function () {
  'use strict';

  var STUDIO = 'https://studio.prospektor.ai';
  var API = STUDIO + '/api/help';

  var $nav = document.getElementById('helpNav');
  var $article = document.getElementById('helpArticle');
  var $results = document.getElementById('helpResults');
  var $search = document.getElementById('helpSearch');
  if (!$nav || !$article) return;

  var articles = []; // { slug, title, name, text, html, headings: [{id, text}] }

  /* ── markdown → HTML, sized to what the corpus actually uses:
     h1–h3, flat and one-level-nested lists (- and 1.), tables, and
     bold / italic / inline code / links inside any of them. Everything is
     HTML-escaped first; the corpus is our own docs, but the renderer
     should not have to trust that. */

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

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
        out.push('<h' + level + ' id="' + id + '">' + inline(esc(text)) + '</h' + level + '>');
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

  /* ── navigation ── */

  function slugOf(name) {
    return name.replace(/^\d+-/, '').replace(/\.md$/, '');
  }

  function current() {
    var hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    var slug = hash.split('--')[0];
    for (var k = 0; k < articles.length; k++) if (articles[k].slug === slug) return articles[k];
    return articles[0];
  }

  function show(article, anchor) {
    $results.hidden = true;
    $article.hidden = false;
    $article.innerHTML = article.html;
    var links = $nav.querySelectorAll('a');
    for (var k = 0; k < links.length; k++) {
      links[k].classList.toggle('is-current', links[k].getAttribute('data-slug') === article.slug);
    }
    document.title = article.title + ' — Help — Prospektor';
    if (anchor) {
      var target = document.getElementById(anchor);
      if (target) {
        target.scrollIntoView({ block: 'start' });
        target.classList.add('help-flash');
        setTimeout(function () { target.classList.remove('help-flash'); }, 1600);
        return;
      }
    }
    if ($article.getBoundingClientRect().top < 0) $article.scrollIntoView({ block: 'start' });
  }

  function route() {
    if (!articles.length) return;
    var hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    show(current(), hash.indexOf('--') > -1 ? hash : null);
  }

  /* ── search: score title > heading > body, show snippets, jump to the
     nearest heading above the match. Both the index and the snippets use a
     plain-text rendering of each article — markdown syntax in a snippet
     reads as noise, and nobody searches for "**". ── */

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

  function snippet(text, pos, len) {
    var start = Math.max(0, pos - 60);
    var end = Math.min(text.length, pos + len + 90);
    return (start > 0 ? '…' : '') + text.slice(start, pos) +
      '<mark>' + text.slice(pos, pos + len) + '</mark>' +
      text.slice(pos + len, end) + (end < text.length ? '…' : '');
  }

  function headingAbove(article, pos) {
    var best = null;
    for (var k = 0; k < article.plainHeadings.length; k++) {
      if (article.plainHeadings[k].pos > pos) break;
      best = article.plainHeadings[k].text;
    }
    return best;
  }

  function search(query) {
    var q = query.trim().toLowerCase();
    if (q.length < 2) { $results.hidden = true; $article.hidden = false; return; }
    var hits = [];
    for (var k = 0; k < articles.length; k++) {
      var a = articles[k];
      var plain = a.plain;
      var lower = plain.toLowerCase();
      var inTitle = a.title.toLowerCase().indexOf(q) > -1;
      var matches = [];
      var from = 0;
      while (matches.length < 3) {
        var pos = lower.indexOf(q, from);
        if (pos === -1) break;
        var head = headingAbove(a, pos);
        matches.push({
          snippet: snippet(esc(plain), esc(plain.slice(0, pos)).length, esc(plain.slice(pos, pos + q.length)).length),
          anchor: head ? a.slug + '--' + slugify(head) : null,
          heading: head,
        });
        // step well past the match: three snippets of the same sentence
        // (share, shared, /shares…) tell the reader less than three places
        from = pos + Math.max(q.length, 80);
      }
      if (inTitle || matches.length) {
        hits.push({ article: a, inTitle: inTitle, matches: matches });
      }
    }
    hits.sort(function (x, y) { return (y.inTitle - x.inTitle) || (y.matches.length - x.matches.length); });

    if (!hits.length) {
      $results.innerHTML = '<p class="help-dim">Nothing in the guides matches “' + esc(query) + '”. The <strong>Support</strong> pill inside the studio can still answer it.</p>';
    } else {
      $results.innerHTML = hits.map(function (h) {
        return '<div class="help-hit">' +
          '<a class="help-hit-title" href="#' + h.article.slug + '">' + esc(h.article.title) + '</a>' +
          h.matches.map(function (m) {
            return '<a class="help-hit-snippet" href="#' + (m.anchor || h.article.slug) + '">' +
              (m.heading ? '<span class="help-hit-heading">' + esc(m.heading) + '</span>' : '') +
              '<span>' + m.snippet + '</span></a>';
          }).join('') +
          '</div>';
      }).join('');
    }
    $article.hidden = true;
    $results.hidden = false;
  }

  $search.addEventListener('input', function () { search($search.value); });
  $search.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { $search.value = ''; search(''); $search.blur(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== $search &&
        !/^(input|textarea)$/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      $search.focus();
    }
  });
  // A result click sets the hash; hashchange re-renders. Clear the query so
  // the article is visible again (route() already swapped the panels).
  window.addEventListener('hashchange', function () { $search.value = ''; route(); });

  /* ── boot ── */

  function fail() {
    $article.innerHTML =
      '<p>The guides could not be loaded right now — they are served live from the studio, and the studio did not answer.</p>' +
      '<p><button type="button" class="help-retry" id="helpRetry">Try again</button></p>' +
      '<p class="help-dim">If this keeps happening, write to <a href="mailto:hello@prospektor.ai">hello@prospektor.ai</a>.</p>';
    var btn = document.getElementById('helpRetry');
    if (btn) btn.addEventListener('click', boot);
  }

  function boot() {
    fetch(API)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (body) {
        articles = (body.files || []).map(function (file) {
          var slug = slugOf(file.name);
          var title = (file.text.match(/^#\s+(.*)$/m) || [null, slug])[1];
          var rendered = render(file.text, slug);
          var plain = plainText(file.text);
          return { slug: slug, title: title, name: file.name, text: file.text, html: rendered.html, headings: rendered.headings, plain: plain.text, plainHeadings: plain.headings };
        });
        if (!articles.length) throw new Error('empty corpus');
        $nav.innerHTML = articles.map(function (a) {
          return '<a href="#' + a.slug + '" data-slug="' + a.slug + '">' + esc(a.title) + '</a>';
        }).join('');
        route();
      })
      .catch(function (error) {
        console.error('help corpus failed to load', error);
        fail();
      });
  }

  boot();
})();
