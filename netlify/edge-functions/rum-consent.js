/*
 * #143 — take Netlify's Real User Metrics tag back out of the served HTML, so
 * consent can decide whether it ever runs.
 *
 * ── Why this exists ──
 *
 * The handover's step 5 assumed the RUM tag was ours to write, and that gating
 * it was one `ppsConsent.gate('analytics', …)` at a call site. It is not in any
 * template in this repo. Netlify injects it into the response itself, as the
 * last thing before </body>:
 *
 *   <script async id="netlify-rum-container" src="/.netlify/scripts/rum"
 *           data-netlify-cwv-token="…"></script>
 *
 * There is no netlify.toml key that turns that off — the switch is a toggle in
 * Netlify's dashboard, and flipping it would lose the metrics rather than gate
 * them. So the response is the only place the tag can be caught, and an edge
 * function is the only thing in this repo that sees the response.
 *
 * Measured against production, 24 Aug 2026: the script stores nothing at all —
 * no cookie, no localStorage, no sessionStorage — so it stays exempt under
 * ePrivacy Art. 5(3), exactly as the 23 Aug reading found. What that reading
 * did not name is where the beacon goes:
 *
 *   POST https://ingesteer.services-prod.nsvcs.net/rum_collection
 *
 * — cross-origin, keepalive, carrying the page's timings and the visitor's IP.
 * It is the one third party this origin has. Gating it is the difference
 * between a banner that offers a real choice and one that offers a decoration.
 *
 * ── What it does, and what it refuses to do ──
 *
 * The tag is replaced by an inert JSON handoff that no browser will fetch:
 *
 *   <script type="application/json" id="ppsc-gated-rum">{"src":…}</script>
 *
 * `consent.js` re-creates a real script tag from it, and only from inside
 * `gate('analytics', …)`. Nothing else reads it.
 *
 * It fails open, twice over: `onError: 'bypass'` hands Netlify's own response
 * straight to the visitor if this function throws, and every branch that
 * cannot do the job returns the untouched response rather than an error page.
 * The worst case is therefore exactly today's behaviour — RUM ungated — never
 * a broken page on the origin that carries the buy form. That failure is
 * silent from inside the page, so it is `npm run audit` that asks production
 * whether the tag is really gone.
 */

const RUM_TAG = /<script\b[^>]*\bid="netlify-rum-container"[^>]*>\s*<\/script>/i;
const ATTRIBUTE = /([a-zA-Z][a-zA-Z0-9:_.-]*)\s*=\s*"([^"]*)"/g;

/** The transform, separated from the plumbing: HTML in, HTML out, or null if
 *  there is nothing here to gate. */
export function gateRumTag(html) {
  const match = html.match(RUM_TAG);
  if (!match) return null;
  const tag = match[0];
  const attrs = {};
  ATTRIBUTE.lastIndex = 0;
  let found;
  while ((found = ATTRIBUTE.exec(tag)) !== null) {
    const name = found[1].toLowerCase();
    if (name === 'src' || name === 'id' || name.startsWith('data-')) attrs[name] = found[2];
  }
  // A tag we cannot faithfully hand back is a tag we must not remove: a broken
  // gate that also loses the metrics is the worst of both.
  if (typeof attrs.src !== 'string' || !attrs.src.startsWith('/') || attrs.src.startsWith('//')) return null;
  const json = JSON.stringify(attrs).replace(/</g, '\\u003c');
  return html.replace(tag, `<script type="application/json" id="ppsc-gated-rum">${json}</script>`);
}

export default async (request, context) => {
  const response = await context.next();
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;

  let html;
  try {
    html = await response.clone().text();
  } catch (e) {
    return response;
  }

  let gated;
  try {
    gated = gateRumTag(html);
  } catch (e) {
    return response;
  }
  if (gated === null) return response;

  const headers = new Headers(response.headers);
  headers.delete('content-length'); // the body just got shorter
  return new Response(gated, { status: response.status, statusText: response.statusText, headers });
};

export const config = {
  path: '/*',
  // Only HTML documents carry the injected tag. Everything static is skipped
  // so this does not sit in front of the fonts, the CSS or the functions.
  excludedPath: ['/assets/*', '/.netlify/*', '/*.xml', '/*.txt', '/*.svg', '/*.png', '/*.woff2'],
  onError: 'bypass',
};
