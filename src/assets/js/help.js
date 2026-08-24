/* The help center (#76, redesigned #145, prerendered #136).

   What changed, and why it is worth knowing before editing this file:

   1. The guides are no longer fetched *before* the page is useful. The build
      renders the corpus into the HTML and embeds the markdown it rendered from
      (`#helpCorpus`), so the cards, the guides and the search index all exist
      on first paint — with JavaScript off, and for a crawler, which is the
      whole of #136.

   2. The runtime fetch is still here, because #76's property is worth keeping:
      a help change is live for a human the moment the *studio* deploys, with
      no website publish step in between. What the fetch does now is
      *reconcile*: it hashes the live corpus, compares it with the hash the
      build stamped onto #helpGuides, and if they agree it does nothing at all.
      That is the "no double render" rule — the common case touches no DOM,
      so there is no flash and no duplicated content.

   3. Search is per-term (see help-render.js). The bug this replaces matched
      the whole query as one substring, so "how can I create a new workspace"
      — a question the corpus has answered since #83 — returned nothing while
      "client workspace" found the section.

   4. Since #166 the guides live at /help/<slug>/, one URL each, and this page
      is the hub over them: cards, search and the FAQ. So every link this file
      hands out — a card, a search hit, a snippet, an arriving hash — has to
      resolve to a PAGE rather than to an anchor on this one.

      Except for a guide the last build never saw. The studio can add a guide
      at any moment and #76's property is that it shows here immediately; that
      one has no page yet, so it is rendered inline into #helpGuides and linked
      by anchor, exactly as everything was before #166. `data-pages` on that
      element is the build's list of slugs that do have a page, and it is the
      whole of how the two cases are told apart. */
(function () {
  'use strict';

  var H = window.HelpRender;
  var API = (H && H.STUDIO ? H.STUDIO : 'https://studio.prospektor.ai') + '/api/help';

  var $search = document.getElementById('helpSearch');
  var $results = document.getElementById('helpResults');
  var $hub = document.getElementById('helpHub');
  var $guides = document.getElementById('helpGuides');
  if (!H || !$guides || !$results) return;

  var articles = [];
  var embeddedHash = $guides.getAttribute('data-corpus-hash') || '';

  /* The slugs this build gave a page. Empty is a real and correct state: a
     build that could reach neither the studio nor the snapshot prerenders
     nothing, so nothing has a page and everything renders inline here — which
     is the pre-#136 runtime-only page, and still the right answer. */
  var pages = {};
  ($guides.getAttribute('data-pages') || '').split(/\s+/).forEach(function (slug) {
    if (slug) pages[slug] = true;
  });

  function hasPage(slug) { return !!pages[slug]; }

  /* Where a guide is read. `anchor` is a heading id (slug--heading) or empty.
     A guide with a page is a real URL and a normal navigation; one without is
     an anchor into #helpGuides on this page. */
  function hrefFor(slug, anchor) {
    if (hasPage(slug)) {
      return '/help/' + encodeURIComponent(slug) + '/' + (anchor ? '#' + encodeURIComponent(anchor) : '');
    }
    return '#' + (anchor || ('guide-' + slug));
  }

  /* The guides that must be rendered into this page: the ones with no URL of
     their own. Normally none. */
  function inlineArticles() {
    return articles.filter(function (a) { return !hasPage(a.slug); });
  }

  /* ── the model ──
     Built from the markdown the build embedded, so it is byte-identical to
     what produced the HTML already on screen. No network, no waiting. */

  function readEmbedded() {
    var el = document.getElementById('helpCorpus');
    if (!el) return null;
    try {
      var corpus = JSON.parse(el.textContent);
      if (!corpus || !corpus.files || !corpus.files.length) return null;
      return corpus;
    } catch (e) {
      console.warn('help: the embedded corpus did not parse', e);
      return null;
    }
  }

  /* ── rendering, for the case where the live corpus has actually moved ──
     These two must keep producing what src/help.njk produces; they are the
     same shapes, and the drive checks both paths render the same page. */

  function cardHtml(a) {
    return '<li class="card">' +
      '<a href="' + H.esc(hrefFor(a.slug, '')) + '">' +
      '<span class="card-emoji" aria-hidden="true">' + H.esc(a.emoji) + '</span>' +
      '<span class="card-topic">' + H.esc(a.topic) + '</span>' +
      '<h2 class="card-title">' + H.esc(a.title) + '</h2>' +
      '<p class="card-dek">' + H.esc(a.dek) + '</p>' +
      '<span class="card-cta">Read the guide <span aria-hidden="true">→</span></span>' +
      '</a></li>';
  }

  function guideHtml(a) {
    return '<article class="help-guide" id="guide-' + a.slug + '" data-slug="' + a.slug + '">' +
      '<span class="help-guide-topic">' + H.esc(a.emoji) + ' ' + H.esc(a.topic) + '</span>' +
      a.html +
      '<a class="help-guide-top" href="#helpHub">↑ All guides</a>' +
      '</article>';
  }

  function paint() {
    if ($hub) $hub.innerHTML = '<ul class="card-grid">' + articles.map(cardHtml).join('') + '</ul>';
    // Only the guides with no page of their own. A guide that HAS a page must
    // not also be rendered here: two URLs carrying the same text is the exact
    // duplication #166 exists to remove, and it would be re-created at runtime.
    $guides.innerHTML = inlineArticles().map(guideHtml).join('');
  }

  /* ── search ── */

  function snippetHtml(s) {
    return H.esc(s.before) + '<mark>' + H.esc(s.match) + '</mark>' + H.esc(s.after);
  }

  function showResults(on) {
    $results.hidden = !on;
    if ($hub) $hub.hidden = on;
    $guides.hidden = on;
  }

  /* A search hit's link. The title goes to the guide; a snippet goes to the
     heading it was found under, which since #166 may be an anchor on another
     page. Both are ordinary links when they leave this page — the click
     handler below only intercepts the ones that stay. */
  function hitHref(article, anchor) {
    return H.esc(hrefFor(article.slug, anchor && anchor !== article.slug ? anchor : ''));
  }

  function search(query) {
    var q = String(query || '').trim();
    if (q.length < 2) { showResults(false); return; }

    var hits = H.search(articles, q);

    if (!hits.length) {
      $results.innerHTML = '<p class="help-dim">Nothing in the guides matches “' + H.esc(q) +
        '”. The <strong>Support</strong> pill inside the studio can still answer it.</p>';
    } else {
      var head = '';
      if (hits[0].partial) {
        head = '<p class="help-dim help-results-note">No guide covers all of that — these come closest.</p>';
      }
      $results.innerHTML = head + hits.map(function (h) {
        return '<div class="help-hit">' +
          '<a class="help-hit-title" href="' + hitHref(h.article, '') + '">' +
            '<span class="help-hit-emoji" aria-hidden="true">' + H.esc(h.article.emoji) + '</span>' +
            H.esc(h.article.title) +
          '</a>' +
          h.snippets.map(function (m) {
            return '<a class="help-hit-snippet" href="' + hitHref(h.article, m.anchor) + '">' +
              (m.heading ? '<span class="help-hit-heading">' + H.esc(m.heading) + '</span>' : '') +
              '<span>' + snippetHtml(m.snippet) + '</span></a>';
          }).join('') +
          '</div>';
      }).join('');
    }
    showResults(true);
  }

  /* A result points into a guide that is hidden while the results are up, so
     the panels have to be swapped back before the browser tries to scroll. */
  function onResultClick(e) {
    var link = e.target.closest ? e.target.closest('.help-hit-title, .help-hit-snippet') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    // Since #166 most hits are links to /help/<slug>/. Those are navigations,
    // not scrolls — leave the browser alone. Only a hit into a guide rendered
    // on THIS page needs the results panel swapped away before the jump.
    if (href.charAt(0) !== '#') return;
    var id = decodeURIComponent(href.replace(/^#/, ''));
    if (!id) return;
    e.preventDefault();
    if ($search) $search.value = '';
    showResults(false);
    jumpTo(id);
    if (location.hash.replace(/^#/, '') !== id) history.pushState(null, '', '#' + id);
  }

  function jumpTo(id) {
    var target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    target.classList.add('help-flash');
    setTimeout(function () { target.classList.remove('help-flash'); }, 1600);
  }

  /* Three generations of link now arrive at this page, and all of them must
     land somewhere real:

       /help/#sharing              the pre-#145 shape, one guide per hash
       /help/#guide-sharing        the #145/#136 hub shape
       /help/#sharing--revoking    a heading inside a guide, either era

     Since #166 the guide is at /help/sharing/, so the first two are a
     redirect and the third is a redirect that keeps its heading. `replace`
     rather than `assign`: the anchor URL should not sit in the reader's back
     button between them and the page they were on.

     A guide with no page of its own still resolves by scrolling, exactly as
     before — which is also what happens on a build that prerendered nothing. */
  function migrateHash() {
    var hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!hash) return;

    var slug = hash.indexOf('guide-') === 0 ? hash.slice(6)
      : hash.indexOf('--') > -1 ? hash.slice(0, hash.indexOf('--'))
      : hash;
    var anchor = hash.indexOf('--') > -1 ? hash : '';

    var known = false;
    for (var k = 0; k < articles.length; k++) if (articles[k].slug === slug) known = true;
    if (!known) return;

    if (hasPage(slug)) { location.replace(hrefFor(slug, anchor)); return; }

    var target = anchor || ('guide-' + slug);
    if (hash !== target) history.replaceState(null, '', '#' + target);
    jumpTo(target);
  }

  /* ── the reconcile ──
     The only reason to touch the DOM is that the studio's corpus has moved
     since this page was built. Anything else is a re-render for nothing. */

  function reconcile(files) {
    var liveHash = H.corpusHash(files);
    if (liveHash === embeddedHash) return false;   // the page is already right

    articles = H.buildIndex(files);
    embeddedHash = liveHash;
    $guides.setAttribute('data-corpus-hash', liveHash);
    $guides.setAttribute('data-corpus-source', 'runtime');
    paint();

    // Whatever the reader was looking at should still be under them.
    var hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (hash && !$guides.hidden) jumpTo(hash);
    if ($search && $search.value.trim().length > 1) search($search.value);
    return true;
  }

  function offerRetry(message) {
    if ($hub) {
      $hub.innerHTML =
        '<p>' + message + '</p>' +
        '<p><button type="button" class="help-retry" id="helpRetry">Try again</button></p>' +
        '<p class="help-dim">If this keeps happening, write to ' +
        '<a href="mailto:hello@prospektor.ai">hello@prospektor.ai</a>.</p>';
      var btn = document.getElementById('helpRetry');
      if (btn) btn.addEventListener('click', boot);
    }
  }

  function boot() {
    fetch(API)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (body) {
        var files = (body && body.files) || [];
        if (!files.length) throw new Error('empty corpus');
        reconcile(files);
        if (!articles.length) { articles = H.buildIndex(files); paint(); migrateHash(); }
      })
      .catch(function (error) {
        // With a prerendered corpus on the page this is a non-event: the
        // reader has every guide already and the only thing lost is any
        // change the studio made since the last website build. It is worth a
        // console line and nothing more.
        if (articles.length) {
          console.warn('help: the live corpus could not be read; showing the build-time copy', error);
          return;
        }
        console.error('help corpus failed to load', error);
        offerRetry('The guides could not be loaded right now — they are served live from the studio, and the studio did not answer.');
      });
  }

  /* ── wiring ── */

  var embedded = readEmbedded();
  if (embedded) {
    articles = H.buildIndex(embedded.files);
    if (!embeddedHash) embeddedHash = embedded.hash || H.corpusHash(embedded.files);
    migrateHash();
  }

  if ($search) {
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
  }

  $results.addEventListener('click', onResultClick);

  // A hash arriving any other way (a card, the back button) means the reader
  // wants a guide, so the results panel steps aside.
  window.addEventListener('hashchange', function () {
    if (!$results.hidden) {
      if ($search) $search.value = '';
      showResults(false);
    }
  });

  boot();
})();
