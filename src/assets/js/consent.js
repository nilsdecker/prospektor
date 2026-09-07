/*
 * Cookie consent (#131) — the gate, not the nag.
 *
 * ── Why this file exists, and why it does not look like a cookie banner ──
 *
 * Measured against production on 23 Aug 2026: neither prospektor.ai nor
 * studio.prospektor.ai sets a single cookie that needs consent, and neither
 * makes a third-party request. The studio's cookies are `pps_session` and the
 * two ten-minute sign-in cookies — strictly necessary, exempt under ePrivacy
 * Art. 5(3) — and its browser storage is two device preferences. The German
 * Abmahnung wave the operator has heard about is about Google Fonts served
 * from Google's CDN (self-hosted here since 18 Aug) and Google Analytics
 * without prior consent (never installed).
 *
 * So a banner offering a choice that controls nothing would not be protection.
 * Several supervisory authorities read exactly that as a dark pattern, and
 * consent collected today for a purpose that does not exist yet would not be
 * valid consent for that purpose tomorrow anyway (specific and informed,
 * GDPR Art. 4(11)). What is worth building — before Microsoft Clarity (#138),
 * which is session recording and the single most consent-hungry thing this
 * product could add — is the machinery that makes adding it safe:
 *
 *   1. an inventory that says, in one place, what non-essential thing runs;
 *   2. a gate that will not let it run before consent, so wiring it up
 *      wrongly takes effort;
 *   3. a record of the decision, because Art. 7(1) says you must be able to
 *      demonstrate it;
 *   4. withdrawal that is exactly as easy as granting (Art. 7(3));
 *   5. and, today, a truthful account of what *is* stored — which is the
 *      transparency duty that does apply right now (Art. 13).
 *
 * The banner's form follows the inventory rather than a designer's habit:
 *
 *   INVENTORY EMPTY  → a one-line **notice**: what is stored and that nothing
 *                      else is. One button, "Got it", plus "What's stored".
 *                      No fake toggle, because there is nothing to toggle.
 *   INVENTORY FILLED → a **choice**: Accept and Reject, equally weighted and
 *                      equally prominent, plus "Choose". Nothing in an opt-in
 *                      category runs until it is granted.
 *
 * Adding Clarity is therefore: one entry in INVENTORY below, and
 * `ppsConsent.gate('analytics', loadClarity)` at the call site. The banner
 * turns itself into the choice form; nobody has to remember to.
 *
 * ── Portability ──
 *
 * No dependencies, no build step, no framework, one file, classic script.
 * That is deliberate: this is copied verbatim into the website repo (#132),
 * and it would be absurd for the thing that protects us from third-party
 * scripts to be a third-party script. Colours come from the studio's CSS
 * tokens with literal fallbacks, so it also looks right on a page that has
 * never heard of `--brand-accent`.
 *
 * ── This copy: prospektor.ai (#143) ──
 *
 * Copied from the studio's `public/consent.js` on 24 Aug 2026. The reasoning
 * above is the studio's and is kept word for word, because it is the reasoning
 * that produced the file. Three things are different here, and only three:
 *
 *   1. The INVENTORY is this origin's, not the studio's. The marketing site
 *      sets **no cookie at all** — measured 24 Aug, no `set-cookie` on any
 *      response — so its whole necessary list is three browser-storage keys.
 *      The prose that named cookies and signing in went with it: an entry that
 *      is not true is worse than no panel, and that goes for the sentence
 *      above the table as much as for the table.
 *
 *   2. Netlify's Real User Metrics is declared, and gated. Re-measured against
 *      production on 24 Aug, and one fact the 23 Aug reading did not have:
 *      `/.netlify/scripts/rum` still stores nothing — no cookie, no storage of
 *      any kind, so it remains exempt under ePrivacy Art. 5(3) — but the
 *      beacon it sends on the way out is
 *      `POST https://ingesteer.services-prod.nsvcs.net/rum_collection`, a
 *      **cross-origin** request carrying the page's timings and the visitor's
 *      IP. So gating it is not only the "costs nothing, and the site is
 *      correct the day a second tool arrives" argument the handover made; it
 *      is the one third party this origin has, and consent is what now decides
 *      whether it hears from a visitor. Declaring it is also what turns this
 *      banner from a notice into a real, symmetric Accept / Reject — the form
 *      follows the inventory, exactly as designed.
 *
 *   3. It therefore carries a loader the studio's copy does not — see *the
 *      gated script* at the foot of this file. The tag is **injected by
 *      Netlify**, not written by our templates, which is the one thing the
 *      handover's step 5 could not have known; `netlify/edge-functions/
 *      rum-consent.js` takes it back out of the served HTML and leaves the
 *      loader a JSON handoff to re-create it from, under the gate.
 */
(function () {
  'use strict';

  /* ──────────────────────────── the inventory ────────────────────────────
     Everything this origin puts on, or reads from, a visitor's device.
     `necessary` entries are disclosed, never gated. Anything else is opt-in
     and MUST be reached through `gate()`.

     Keep this true. It is the text a visitor reads in the panel, it is what
     decides whether the banner asks a question, and — since 23 Aug — it is
     the only place a new tracker can be introduced without lying. */

  var INVENTORY = [
    {
      id: 'pps-consent',
      name: 'pps-consent',
      kind: 'Local storage',
      category: 'necessary',
      purpose: 'Your answer to this notice, with the date you gave it. It exists so we can show that you were asked — and so we stop asking.',
      retention: '12 months, then we ask again',
    },
    {
      id: 'prospektor.scan',
      name: 'prospektor.scan',
      kind: 'Session storage',
      category: 'necessary',
      purpose: 'The scan you asked for — the domain you typed and what we found about it — held just long enough to carry it from the front page into the checkout form so you do not fill the same thing in twice. It stays in this tab; nothing reads it but this site.',
      retention: 'Until you close the tab, and cleared the moment checkout finishes',
    },
    {
      id: 'prospektor.goal',
      name: 'prospektor.goal',
      kind: 'Session storage',
      category: 'necessary',
      purpose: 'The sentence you typed about what you want the studio to find, kept while you are still on the checkout page so a reload does not lose it.',
      retention: 'Until you close the tab, and cleared the moment checkout finishes',
    },
    {
      id: 'prospektor.lang',
      name: 'prospektor.lang',
      kind: 'Local storage',
      category: 'necessary',
      purpose: 'Your answer to the one-line offer to read this site in the language your browser prefers — the language you chose to stay with, or to switch to — so you are offered it once and not on every page.',
      retention: 'Until you clear your browser data',
    },
    {
      /* Injected by Netlify into the served HTML, not written by our
         templates — which is why gating it needs an edge function and a
         loader rather than one call site. See the header note and the foot
         of this file. */
      id: 'netlify-rum',
      name: 'Netlify Real User Metrics',
      kind: 'Script',
      category: 'analytics',
      provider: 'Netlify',
      purpose: 'How quickly the pages actually load for real people, so we can fix the slow ones. It puts nothing on this device — no cookie, no storage of any kind — but as you leave a page it posts that page’s timings, with your IP address, to Netlify, who host this site. Off unless you turn it on.',
      retention: 'Nothing is kept on this device; Netlify keeps the metrics',
    },
    /* No advertising. No session recording. No third party other than the one
       named above, and nothing at all before consent. When that changes it
       changes HERE first — the banner turns itself into the right shape,
       and `gate()` is the only way in. */
  ];

  /* The categories a person can answer for, in the order they are shown.
     `necessary` is not among them — it is disclosed, not negotiated. */
  var CATEGORIES = [
    {
      id: 'analytics',
      label: 'Analytics',
      blurb: 'Lets us see which screens people actually use, so we fix the confusing ones. Off unless you turn it on.',
    },
    {
      id: 'marketing',
      label: 'Marketing',
      blurb: 'Measuring which adverts brought someone here. Off unless you turn it on.',
    },
  ];

  /* Bumping this re-asks everyone. Bump it when a *purpose* changes — a new
     vendor, a new category, a materially different use — never for wording.
     Consent to version N is not consent to version N+1's new tracker. */
  var POLICY_VERSION = 1;

  /* A decision goes stale. Twelve months is the interval most European
     authorities land on (CNIL says at most 13), and re-asking is cheap. */
  var MAX_AGE_DAYS = 365;

  var STORE_KEY = 'pps-consent';
  var POLICY_URL = 'https://prospektor.ai/privacy/';

  /* ─────────────────────────────── storage ───────────────────────────────
     Private windows throw on every access, and a browser set to block site
     data throws on the read too. A consent manager that dies in a private
     window is worse than none, so every touch is wrapped and the in-memory
     copy is the source of truth for the page either way. */

  function readStored() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.v !== POLICY_VERSION) return null;
      if (!Array.isArray(parsed.granted)) return null;
      var at = Date.parse(parsed.at);
      if (!at || (Date.now() - at) / 86400000 > MAX_AGE_DAYS) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeStored(record) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(record));
      return true;
    } catch (e) {
      /* Nothing to do but remember it for this page. The visitor is asked
         again next time, which is the honest failure mode: we cannot claim a
         consent we could not record. */
      return false;
    }
  }

  /* Global Privacy Control — a browser-level "do not sell or share" signal,
     legally binding under several US state laws and a clear expression of
     objection under Art. 21 wherever it is not. Treated as a standing refusal
     of every opt-in category: we do not ask, and we do not run. The panel
     still opens, and an explicit grant there still wins — the signal is a
     default, not a lock the person cannot open. */
  function gpc() {
    try {
      return window.navigator.globalPrivacyControl === true;
    } catch (e) {
      return false;
    }
  }

  /* ──────────────────────────────── state ──────────────────────────────── */

  var optional = INVENTORY.filter(function (item) { return item.category !== 'necessary'; });
  var liveCategories = CATEGORIES.filter(function (cat) {
    return optional.some(function (item) { return item.category === cat.id; });
  });
  /* The whole question this file asks: is there anything to ask about? */
  var hasChoice = liveCategories.length > 0;

  var stored = readStored();
  var granted = stored ? stored.granted.slice() : [];
  var listeners = [];
  var pending = [];

  function isGranted(category) {
    if (category === 'necessary') return true;
    return granted.indexOf(category) > -1;
  }

  function decided() {
    return !!stored;
  }

  /* Anything queued for a category runs the moment it is granted, and never
     before. A gated function that throws must not take the next one with it —
     an analytics vendor's loader is not worth breaking a page over. */
  function flush() {
    var still = [];
    for (var i = 0; i < pending.length; i++) {
      var job = pending[i];
      if (isGranted(job.category)) {
        try { job.fn(); } catch (e) { /* a tracker is never worth a broken page */ }
      } else {
        still.push(job);
      }
    }
    pending = still;
    for (var j = 0; j < listeners.length; j++) {
      try { listeners[j](granted.slice()); } catch (e) { /* same */ }
    }
  }

  /* One way in, so every recorded decision has the same shape. `how` is part
     of demonstrating consent: "accepted everything", "rejected everything",
     "picked these two" and "the browser refused on my behalf" are four
     different acts and an auditor is entitled to know which one happened. */
  function decide(next, how) {
    granted = next.slice();
    stored = {
      v: POLICY_VERSION,
      at: new Date().toISOString(),
      granted: granted,
      how: how || 'explicit',
    };
    writeStored(stored);
    flush();
  }

  /* ──────────────────────────────── styles ───────────────────────────────
     Injected rather than shipped in the stylesheet so this file stays one
     copyable artefact. Every colour falls back to a literal, because the
     website's palette does not declare the studio's tokens. */

  var CSS = [
    '.ppsc-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;',
    '  display:flex;gap:16px;align-items:center;flex-wrap:wrap;',
    '  padding:16px 20px;box-sizing:border-box;',
    '  background:var(--card,#fff);color:var(--brand-ink,#1d1d1f);',
    '  border-top:1px solid var(--line,rgba(0,0,0,.1));',
    '  box-shadow:var(--shadow-panel,0 -8px 30px rgba(0,0,0,.12));',
    '  font-family:var(--studio-font,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif);',
    '  font-size:13px;line-height:1.55;animation:ppsc-rise .22s ease-out}',
    '@keyframes ppsc-rise{from{transform:translateY(100%)}to{transform:translateY(0)}}',
    '@media (prefers-reduced-motion:reduce){.ppsc-bar{animation:none}}',
    '.ppsc-bar-text{flex:1 1 320px;margin:0;min-width:0}',
    '.ppsc-bar-text strong{font-weight:600}',
    '.ppsc-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
    /* Accept and Reject are the same size, the same weight and the same
       visual pull. That symmetry is the thing enforcement actions are
       actually about; a grey "reject" beside a coloured "accept" is the
       finding, not the fix. */
    '.ppsc-btn{font:inherit;font-weight:600;font-size:13px;cursor:pointer;',
    '  border-radius:10px;padding:9px 18px;border:1px solid transparent;white-space:nowrap}',
    '.ppsc-btn-primary{background:var(--brand-accent,#e8533a);color:var(--on-accent,#fff)}',
    '.ppsc-btn-primary:hover{background:var(--coral-hover,#d04530)}',
    '.ppsc-btn-equal{background:var(--fill,rgba(120,120,128,.14));color:var(--brand-ink,#1d1d1f);',
    '  border-color:var(--line,rgba(0,0,0,.1))}',
    '.ppsc-btn-equal:hover{background:var(--sand,#e8e8ed)}',
    '.ppsc-link{background:none;border:0;padding:0;font:inherit;font-size:13px;font-weight:600;',
    '  color:var(--accent-ink,#e8533a);cursor:pointer;text-decoration:underline;',
    '  text-underline-offset:2px}',
    '.ppsc-link:hover{text-decoration-thickness:2px}',
    '.ppsc-scrim{position:fixed;inset:0;z-index:2147483001;background:var(--overlay,rgba(26,26,24,.45));',
    '  display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}',
    '.ppsc-panel{background:var(--card,#fff);color:var(--brand-ink,#1d1d1f);',
    '  border-radius:var(--radius,14px);box-shadow:var(--shadow-panel,0 18px 50px rgba(0,0,0,.3));',
    '  width:min(620px,100%);max-height:min(86vh,760px);overflow:auto;',
    '  font-family:var(--studio-font,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif);',
    '  font-size:13px;line-height:1.6;box-sizing:border-box}',
    '.ppsc-panel-head{display:flex;align-items:flex-start;gap:14px;padding:22px 24px 0}',
    '.ppsc-panel h2{margin:0;font-size:17px;font-weight:600;flex:1}',
    '.ppsc-close{background:none;border:0;font-size:20px;line-height:1;cursor:pointer;',
    '  color:var(--faint,#86868b);padding:2px 4px;border-radius:6px}',
    '.ppsc-close:hover{color:var(--brand-ink,#1d1d1f)}',
    '.ppsc-panel-body{padding:6px 24px 0}',
    '.ppsc-lede{color:var(--muted,#6e6e73);margin:6px 0 18px}',
    '.ppsc-cat{display:flex;gap:14px;align-items:flex-start;padding:14px 0;',
    '  border-top:1px solid var(--hairline,rgba(0,0,0,.06))}',
    '.ppsc-cat-copy{flex:1;min-width:0}',
    '.ppsc-cat-name{font-weight:600;display:block}',
    '.ppsc-cat-blurb{color:var(--muted,#6e6e73);display:block;margin-top:2px}',
    '.ppsc-locked{font-size:12px;font-weight:600;color:var(--signal-dim,#00956a);',
    '  background:var(--mint,#e5f6f0);border-radius:6px;padding:4px 9px;white-space:nowrap;flex:0 0 auto}',
    '.ppsc-switch{appearance:none;-webkit-appearance:none;margin:2px 0 0;cursor:pointer;',
    '  width:38px;height:23px;border-radius:999px;flex:0 0 auto;position:relative;',
    '  background:var(--track,rgba(120,120,128,.28));transition:background .15s;border:0}',
    '.ppsc-switch::after{content:"";position:absolute;top:2px;left:2px;width:19px;height:19px;',
    '  border-radius:50%;background:var(--knob,#fff);box-shadow:var(--shadow-knob,0 1px 3px rgba(0,0,0,.2));',
    '  transition:left .15s}',
    '.ppsc-switch:checked{background:var(--signal,#00b37e)}',
    '.ppsc-switch:checked::after{left:17px}',
    '.ppsc-switch:focus-visible,.ppsc-btn:focus-visible,.ppsc-link:focus-visible,',
    '.ppsc-close:focus-visible,.ppsc-disclose summary:focus-visible',
    '  {outline:2px solid var(--signal,#00b37e);outline-offset:2px}',
    '.ppsc-disclose{border-top:1px solid var(--hairline,rgba(0,0,0,.06));padding:12px 0 2px}',
    '.ppsc-disclose summary{cursor:pointer;font-weight:600;list-style:none;padding:2px 0;border-radius:6px}',
    '.ppsc-disclose summary::-webkit-details-marker{display:none}',
    '.ppsc-disclose summary::before{content:"\\25B8";display:inline-block;width:14px;',
    '  color:var(--faint,#86868b);transition:transform .15s}',
    '.ppsc-disclose[open] summary::before{transform:rotate(90deg)}',
    '.ppsc-table{width:100%;border-collapse:collapse;margin:10px 0 4px;font-size:12.5px}',
    '.ppsc-table th{text-align:left;font-weight:600;color:var(--muted,#6e6e73);',
    '  padding:6px 10px 6px 0;vertical-align:top;white-space:nowrap}',
    '.ppsc-table td{padding:6px 10px 6px 0;vertical-align:top;',
    '  border-top:1px solid var(--hairline,rgba(0,0,0,.06));color:var(--muted,#6e6e73)}',
    '.ppsc-table td:first-child{color:var(--brand-ink,#1d1d1f);font-family:var(--mono,ui-monospace,Menlo,monospace);',
    '  font-size:12px;word-break:break-word}',
    '.ppsc-panel-foot{display:flex;gap:10px;flex-wrap:wrap;align-items:center;',
    '  padding:18px 24px 22px;border-top:1px solid var(--hairline,rgba(0,0,0,.06));margin-top:14px}',
    '.ppsc-foot-note{flex:1 1 160px;color:var(--faint,#86868b);font-size:12px;margin:0}',
    '.ppsc-gpc{margin:0 0 14px;padding:10px 12px;border-radius:10px;',
    '  background:var(--mint,#e5f6f0);color:var(--signal-dim,#00956a);font-size:12.5px}',
    '@media (max-width:560px){.ppsc-bar{gap:12px;padding:14px 16px}',
    '  .ppsc-actions{width:100%}.ppsc-actions .ppsc-btn{flex:1 1 auto;text-align:center}}',
  ].join('');

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.id = 'ppsc-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  /* ──────────────────────────────── the UI ─────────────────────────────── */

  var barEl = null;
  var scrimEl = null;
  var lastFocus = null;

  function el(tag, props, kids) {
    var node = document.createElement(tag);
    if (props) {
      for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        if (key === 'class') node.className = props[key];
        else if (key === 'text') node.textContent = props[key];
        else if (key === 'html') node.innerHTML = props[key];
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), props[key]);
        else node.setAttribute(key, props[key]);
      }
    }
    (kids || []).forEach(function (kid) { if (kid) node.appendChild(kid); });
    return node;
  }

  /* The bar is fixed to the bottom of the viewport, and it is not the only
     thing that lives there — the studio's support panel is anchored to the
     same corner, and its Send button ended up underneath the notice on the
     first run of `npm run drive:support`. So the bar publishes its own height
     as `--ppsc-inset` on <html>, and anything anchored to the bottom adds it
     to its own offset (see `.support-panel` in studio.css). A page that never
     reads the variable pays nothing for it, which is what keeps this file
     copyable into a repo that has never heard of the studio's panels. */
  function publishInset() {
    try {
      var height = barEl && barEl.getBoundingClientRect
        ? Math.ceil(barEl.getBoundingClientRect().height)
        : 0;
      document.documentElement.style.setProperty('--ppsc-inset', height ? height + 'px' : '0px');
    } catch (e) { /* layout we cannot measure is not worth breaking a page over */ }
  }

  function closeBar() {
    if (barEl && barEl.parentNode) barEl.parentNode.removeChild(barEl);
    barEl = null;
    publishInset();
    window.removeEventListener('resize', publishInset);
  }

  /* Someone already inside a modal — the first-run tour, most of the time —
     is mid-conversation with the product. Interrupting that with a second
     overlay is how a notice gets dismissed unread, which serves nobody. Wait
     for it, generically: `aria-modal` is the standard way a page says "this
     has the screen", and using it rather than a class name is what keeps this
     file free of studio-specific knowledge. */
  function modalOpen() {
    var open = document.querySelectorAll('[aria-modal="true"]');
    for (var i = 0; i < open.length; i++) {
      var node = open[i];
      if (scrimEl && scrimEl.contains && scrimEl.contains(node)) continue;
      if (node.getClientRects && node.getClientRects().length) return true;
      if (node.offsetParent) return true;
    }
    return false;
  }

  function showBar() {
    if (barEl || decided()) return;
    /* A browser that has already refused on the person's behalf should not be
       asked to refuse again. We record the refusal and stay quiet. */
    if (hasChoice && gpc()) {
      decide([], 'gpc');
      return;
    }
    if (modalOpen()) {
      window.setTimeout(showBar, 700);
      return;
    }
    injectStyles();

    var text = hasChoice
      ? el('p', {
        class: 'ppsc-bar-text',
        html: '<strong>Your choice about how you are measured.</strong> This site sets no cookies. It keeps a couple of things in your own browser so the scan you asked for survives the trip to checkout — those always run. '
          + 'Anything that measures your visit is off until you turn it on.',
      })
      : el('p', {
        class: 'ppsc-bar-text',
        html: '<strong>A short note about cookies.</strong> This site sets none at all. It keeps a couple of things in your own browser so the scan you asked for survives the trip to checkout, and nothing else. '
          + '<em>No analytics, no advertising, no session recording, no third parties</em> — so there is nothing here to opt into.',
      });

    var actions = hasChoice
      ? el('div', { class: 'ppsc-actions' }, [
        el('button', {
          type: 'button', class: 'ppsc-btn ppsc-btn-equal',
          text: 'Reject', onclick: function () { decide([], 'reject-all'); closeBar(); },
        }),
        el('button', {
          type: 'button', class: 'ppsc-btn ppsc-btn-primary',
          text: 'Accept', onclick: function () {
            decide(liveCategories.map(function (c) { return c.id; }), 'accept-all');
            closeBar();
          },
        }),
        el('button', { type: 'button', class: 'ppsc-link', text: 'Choose', onclick: function () { openPanel(); } }),
      ])
      : el('div', { class: 'ppsc-actions' }, [
        el('button', {
          type: 'button', class: 'ppsc-btn ppsc-btn-primary',
          text: 'Got it', onclick: function () { decide([], 'acknowledged'); closeBar(); },
        }),
        el('button', { type: 'button', class: 'ppsc-link', text: 'What’s stored', onclick: function () { openPanel(); } }),
      ]);

    barEl = el('div', {
      class: 'ppsc-bar',
      /* Not a dialog: it does not trap focus and it does not block the page.
         `complementary` with a label is what a screen reader wants for a
         persistent notice that the reader can leave and come back to. */
      role: 'complementary',
      'aria-label': 'Cookie notice',
    }, [text, actions]);
    document.body.appendChild(barEl);
    publishInset();
    window.addEventListener('resize', publishInset);
  }

  function categoryRow(cat, checked) {
    var input = el('input', {
      type: 'checkbox',
      class: 'ppsc-switch',
      id: 'ppsc-cat-' + cat.id,
      'aria-describedby': 'ppsc-blurb-' + cat.id,
    });
    input.checked = !!checked;
    return el('div', { class: 'ppsc-cat' }, [
      el('label', { class: 'ppsc-cat-copy', for: 'ppsc-cat-' + cat.id }, [
        el('span', { class: 'ppsc-cat-name', text: cat.label }),
        el('span', { class: 'ppsc-cat-blurb', id: 'ppsc-blurb-' + cat.id, text: cat.blurb }),
      ]),
      input,
    ]);
  }

  function inventoryTable(items) {
    var head = el('tr', {}, [
      el('th', { text: 'Name' }),
      el('th', { text: 'Kind' }),
      el('th', { text: 'What it is for' }),
      el('th', { text: 'Kept' }),
    ]);
    var rows = items.map(function (item) {
      return el('tr', {}, [
        el('td', { text: item.name }),
        el('td', { text: item.kind }),
        el('td', { text: item.purpose }),
        el('td', { text: item.retention }),
      ]);
    });
    return el('table', { class: 'ppsc-table' }, [
      el('thead', {}, [head]),
      el('tbody', {}, rows),
    ]);
  }

  function closePanel() {
    if (scrimEl && scrimEl.parentNode) scrimEl.parentNode.removeChild(scrimEl);
    scrimEl = null;
    document.removeEventListener('keydown', onPanelKey, true);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* gone */ } }
    lastFocus = null;
    if (!decided()) showBar();
  }

  function focusables() {
    if (!scrimEl) return [];
    return Array.prototype.slice.call(
      scrimEl.querySelectorAll('button, input, a[href], summary, [tabindex]:not([tabindex="-1"])'),
    ).filter(function (node) { return node.offsetParent !== null || node === document.activeElement; });
  }

  /* Escape closes, Tab cannot walk out of a modal dialog and behind the
     scrim. Capture phase, because the studio's own key handlers are on the
     document too and a settings panel must win while it is open. */
  function onPanelKey(event) {
    if (!scrimEl) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
      return;
    }
    if (event.key !== 'Tab') return;
    var list = focusables();
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openPanel() {
    if (scrimEl) return;
    injectStyles();
    closeBar();
    lastFocus = document.activeElement;

    var necessary = INVENTORY.filter(function (i) { return i.category === 'necessary'; });
    var switches = {};

    var body = el('div', { class: 'ppsc-panel-body' }, [
      el('p', {
        class: 'ppsc-lede',
        text: hasChoice
          ? 'Everything Prospektor stores on this device, and what you can turn off. Nothing in an optional group runs before you allow it.'
          : 'Everything Prospektor stores on this device. There is nothing optional to turn off right now — this is the whole list, and it is the same list the code works from.',
      }),
    ]);

    if (gpc()) {
      body.appendChild(el('p', {
        class: 'ppsc-gpc',
        text: 'Your browser is sending a Global Privacy Control signal. We read that as "no" to everything optional, and we have recorded it that way. You can still turn something on here if you want to.',
      }));
    }

    /* Always shown, always locked on, always named. "Strictly necessary" is a
       claim, and a claim you will not itemise is one nobody can check. */
    body.appendChild(el('div', { class: 'ppsc-cat' }, [
      el('div', { class: 'ppsc-cat-copy' }, [
        el('span', { class: 'ppsc-cat-name', text: 'Strictly necessary' }),
        el('span', {
          class: 'ppsc-cat-blurb',
          text: 'Remembering the answer you give here, and carrying the scan you asked for from the front page into the checkout form. This site sets no cookies at all — these are keys in your own browser, they are never sent anywhere on their own, and there is no account behind them. Nothing here works without them, so they need no permission — but here they are, every one of them.',
        }),
      ]),
      el('span', { class: 'ppsc-locked', text: 'Always on' }),
    ]));
    body.appendChild(el('details', { class: 'ppsc-disclose' }, [
      el('summary', { text: 'What’s in it — ' + necessary.length + ' items' }),
      inventoryTable(necessary),
    ]));

    liveCategories.forEach(function (cat) {
      var row = categoryRow(cat, isGranted(cat.id));
      switches[cat.id] = row.querySelector('input');
      body.appendChild(row);
      var items = optional.filter(function (i) { return i.category === cat.id; });
      if (items.length) {
        body.appendChild(el('details', { class: 'ppsc-disclose' }, [
          el('summary', { text: 'What’s in it — ' + items.length + ' items' }),
          inventoryTable(items),
        ]));
      }
    });

    if (!hasChoice) {
      body.appendChild(el('div', { class: 'ppsc-cat' }, [
        el('div', { class: 'ppsc-cat-copy' }, [
          el('span', { class: 'ppsc-cat-name', text: 'Analytics, advertising, session recording' }),
          el('span', {
            class: 'ppsc-cat-blurb',
            text: 'None. Not off-by-default — absent. The pages make no third-party request at all, and no third party receives anything about your visit. If that ever changes, this notice changes with it and asks you first.',
          }),
        ]),
        el('span', { class: 'ppsc-locked', text: 'None' }),
      ]));
    }

    var foot = el('div', { class: 'ppsc-panel-foot' }, [
      el('p', { class: 'ppsc-foot-note' }, [
        document.createTextNode('The full detail is in the '),
        el('a', { href: POLICY_URL, target: '_blank', rel: 'noopener', text: 'privacy policy' }),
        document.createTextNode('. You can change this any time from the Cookies link in the footer.'),
      ]),
    ]);

    if (hasChoice) {
      foot.appendChild(el('button', {
        type: 'button', class: 'ppsc-btn ppsc-btn-equal', text: 'Reject all',
        onclick: function () { decide([], 'reject-all'); closePanel(); },
      }));
      foot.appendChild(el('button', {
        type: 'button', class: 'ppsc-btn ppsc-btn-primary', text: 'Save choices',
        onclick: function () {
          var next = liveCategories
            .filter(function (c) { return switches[c.id] && switches[c.id].checked; })
            .map(function (c) { return c.id; });
          decide(next, 'chosen');
          closePanel();
        },
      }));
    } else {
      foot.appendChild(el('button', {
        type: 'button', class: 'ppsc-btn ppsc-btn-primary', text: 'Close',
        onclick: function () { decide([], 'acknowledged'); closePanel(); },
      }));
    }

    var panel = el('div', {
      class: 'ppsc-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'ppsc-title',
    }, [
      el('div', { class: 'ppsc-panel-head' }, [
        el('h2', { id: 'ppsc-title', text: hasChoice ? 'Cookies and your choices' : 'What Prospektor stores on this device' }),
        el('button', {
          type: 'button', class: 'ppsc-close', 'aria-label': 'Close', html: '&times;',
          onclick: function () { closePanel(); },
        }),
      ]),
      body,
      foot,
    ]);

    scrimEl = el('div', {
      class: 'ppsc-scrim',
      onclick: function (event) { if (event.target === scrimEl) closePanel(); },
    }, [panel]);

    document.body.appendChild(scrimEl);
    document.addEventListener('keydown', onPanelKey, true);
    var first = focusables()[0];
    if (first) { try { first.focus(); } catch (e) { /* nothing focusable yet */ } }
  }

  /* ─────────────────────────────── the API ───────────────────────────────
     Small on purpose. `gate` is the one every caller should reach for: it
     makes "load this only with consent" the path of least resistance, and
     makes forgetting the check impossible rather than merely discouraged. */

  var api = {
    /** Has this category been granted? `necessary` is always true. */
    granted: isGranted,

    /** Has the visitor answered at all (under the current policy version)? */
    decided: decided,

    /** The categories granted right now. */
    categories: function () { return granted.slice(); },

    /** The declared inventory — what the panel shows, and the whole truth. */
    inventory: function () { return INVENTORY.slice(); },

    /**
     * Run `fn` when `category` is granted, and never before. Runs immediately
     * if it is already granted; queues if not; runs on a later grant; drops
     * quietly on a later withdrawal. This is how Clarity (#138) or any
     * analytics tag must be loaded — never a bare <script> tag.
     */
    gate: function (category, fn) {
      if (typeof fn !== 'function') return;
      if (category === 'necessary' || isGranted(category)) {
        try { fn(); } catch (e) { /* a tracker is never worth a broken page */ }
        return;
      }
      pending.push({ category: category, fn: fn });
    },

    /** Called with the granted list whenever it changes. */
    onChange: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
    },

    /** Open the preferences panel — the withdrawal path Art. 7(3) requires. */
    open: openPanel,

    /** Forget the decision and ask again. Used by the panel's own reset and by tests. */
    reset: function () {
      try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
      stored = null;
      granted = [];
      flush();
      closePanel();
      showBar();
    },

    /** The stored record, for a support answer or an audit. */
    record: function () { return stored ? JSON.parse(JSON.stringify(stored)) : null; },
  };

  window.ppsConsent = api;

  /* ────────────────────────────── wiring up ──────────────────────────────
     `#cookies` anywhere on the origin opens the panel — that is what the
     footer link is, so a page only has to render a plain anchor and nothing
     has to import anything. */

  function hashHook() {
    if (window.location.hash === '#cookies') openPanel();
  }

  function start() {
    /* Wait a beat before the first paint of the bar: a person who has just
       landed should see the product, not a chrome overlay, and a bar that
       animates in after the page is settled is read rather than dismissed.
       The gate is already enforced by then — nothing optional has run. */
    if (!decided()) {
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(function () { window.setTimeout(showBar, 400); });
      } else {
        window.setTimeout(showBar, 400);
      }
    }
    hashHook();
    window.addEventListener('hashchange', hashHook);
    /* Delegated, so a Cookies link rendered later — the studio draws its
       footer from script — still works with no wiring at the call site. */
    document.addEventListener('click', function (event) {
      var node = event.target && event.target.closest ? event.target.closest('[data-cookies], a[href$="#cookies"]') : null;
      if (!node) return;
      event.preventDefault();
      openPanel();
    });
    flush();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* ─────────────────────── the gated script (#143) ────────────────────────
     The one thing on this origin that runs only with consent, and the only
     part of this file the studio's copy does not have.

     Netlify injects its Real User Metrics tag into the served HTML itself,
     immediately before </body> — it is not in any template here, so there is
     no call site to wrap and no repo switch to turn it off (the toggle is in
     Netlify's own dashboard, and turning it off would lose the metrics rather
     than gate them). `netlify/edge-functions/rum-consent.js` therefore takes
     the tag back out of the response and leaves this behind in its place:

       <script type="application/json" id="ppsc-gated-rum">{"src":…}</script>

     — inert markup a browser will not fetch, execute or even parse until
     something asks it to. That something is here, behind the gate, and it is
     the only route back to a live script tag.

     If the node is absent, nothing loads and nothing breaks: locally, where
     Netlify injects nothing, that is simply the normal state. The case worth
     watching is production serving the raw tag again — the edge function
     bypassed on error, or Netlify moving the injection later in its pipeline
     — because then RUM would be loading unasked while this panel said it was
     off. That is not something a page can honestly check about itself, so it
     is checked from outside, against production, by `npm run audit`. */

  var GATED_TAG_ID = 'ppsc-gated-rum';

  function reviveGatedScript() {
    var node = document.getElementById(GATED_TAG_ID);
    if (!node) return;
    var attrs;
    try { attrs = JSON.parse(node.textContent || 'null'); } catch (e) { return; }
    if (!attrs || typeof attrs !== 'object') return;
    /* The handoff is written by our own edge function from a tag our own host
       injected, and it is still filtered: same-origin `src` only, and only
       `id` and `data-*` beside it. A gate that will not let a third party in
       has no business trusting arbitrary attributes on the way back out. */
    if (typeof attrs.src !== 'string' || attrs.src.charAt(0) !== '/' || attrs.src.charAt(1) === '/') return;
    var script = document.createElement('script');
    script.async = true;
    script.src = attrs.src;
    for (var key in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
      if (key === 'src') continue;
      if (key !== 'id' && key.slice(0, 5) !== 'data-') continue;
      if (typeof attrs[key] !== 'string') continue;
      script.setAttribute(key, attrs[key]);
    }
    (document.body || document.documentElement).appendChild(script);
  }

  api.gate('analytics', function () {
    if (document.body) reviveGatedScript();
    else document.addEventListener('DOMContentLoaded', reviveGatedScript);
  });
}());
