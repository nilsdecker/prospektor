/* One help guide, on its own URL (#166) — kept honest at runtime.

   The page is complete without this file: the build rendered the guide into
   the HTML, which is the whole point of giving it a URL. What this adds is the
   property #76 established and #166 was not willing to trade away — a help
   change is live for a *reader* the moment the STUDIO deploys, with no website
   publish step in between.

   So this is a reconcile, not a render. It asks the studio for the corpus,
   fingerprints the one guide this page is about, and compares it with the hash
   the build stamped on. Same hash, no DOM touched at all — the common case
   costs one request and nothing else, which is the same "no double render"
   rule #136 wrote for the hub, narrowed from the corpus to one guide.

   Failure is a non-event and must stay one. The reader has the guide already;
   a studio that does not answer costs them freshness and nothing else, so
   there is no error state on screen — only a console line. Showing "could not
   load" over a page full of answers would be a lie.

   No dependencies, ES5, classic script — same constraints as help-render.js,
   which it needs and which is loaded before it. */
(function () {
  'use strict';

  var H = window.HelpRender;
  var $guide = document.querySelector('.help-guide[data-slug]');
  if (!H || !$guide) return;

  var slug = $guide.getAttribute('data-slug');
  var builtHash = $guide.getAttribute('data-guide-hash') || '';
  var API = (H.STUDIO || 'https://studio.prospektor.ai') + '/api/help';

  function textOf(el, value) { if (el) el.textContent = value; }

  /* The heading the reader arrived at, if any. Re-rendering replaces the
     element they were looking at, so the browser's own scroll anchoring has
     nothing left to hold — put them back deliberately instead. */
  function restore() {
    var id = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (!id) return;
    var target = document.getElementById(id);
    if (target) target.scrollIntoView({ block: 'start' });
  }

  function apply(guide) {
    // bodyOf, not html: the guide's own title is this page's <h1>, and #137
    // pinned one <h1> per page and no heading said twice.
    $guide.innerHTML = H.bodyOf(guide.html);
    textOf(document.querySelector('.help-guide-h1'), guide.title);
    $guide.setAttribute('data-guide-source', 'runtime');
    restore();
  }

  /* With a deadline (#185). Everything above is why the failure path has to be
     reachable at all: a hanging studio used to leave this promise pending
     forever, which is the same as having no failure path. */
  H.fetchCorpus(API, H.CORPUS_TIMEOUT_MS)
    .then(function (body) {
      var files = (body && body.files) || [];
      var mine = null;
      for (var i = 0; i < files.length; i++) {
        if (H.slugOf(files[i].name) === slug) { mine = files[i]; break; }
      }
      if (!mine) {
        // The studio has retired this guide since the last website build. The
        // built copy stays on screen — it is the last true version of it, and
        // blanking the page a reader followed a search result to would be
        // worse. The next build removes the page and the sitemap entry.
        console.warn('help: the studio no longer publishes "' + slug + '" — showing the build-time copy');
        return;
      }
      var liveHash = H.corpusHash([{ name: mine.name, text: mine.text }]);
      if (liveHash === builtHash) return;   // the page is already right

      builtHash = liveHash;
      $guide.setAttribute('data-guide-hash', liveHash);
      apply(H.buildIndex([mine])[0]);
    })
    .catch(function (error) {
      console.warn('help: the live corpus could not be read; showing the build-time copy', error);
    });
})();
