// Open Graph cards: the sitewide one, and one per /resources/ article (#144).
//
// Renders one 1200x630 PNG per article into src/assets/img/og/, using the
// site's own fonts and tokens so a shared link looks like the site rather than
// like a generic blog card.
//
// Run with `npm run og` after adding or retitling an article, and after any
// edit to site.json's tagline or description. Output is committed — the Netlify
// build must not need a browser, so this is a local authoring step, not a build
// step.
//
// #450: the SITEWIDE card (src/assets/img/og.png) is rendered here too, and
// that is new. It used to be a hand-made PNG that nothing regenerated, and it
// drifted exactly the way #216 predicted the article footers would: #168
// retired "Your AI pre-sales team" on 25 Aug because presales is an occupied
// category, every template was corrected the same day — and the image, which
// is what actually unfurls when somebody pastes prospektor.ai into Slack or
// LinkedIn, went on saying it for six days. A string in a template gets found
// by grep; a string baked into a bitmap does not. So the bitmap is generated
// from site.json now, and `npm run og` is what keeps the two honest.
//
// The filename never moves. CLAUDE.md's asset contract excludes /assets/img/
// from content-hashing precisely because these URLs live in caches this repo
// does not control — so the card is rewritten in place and picked up as those
// caches expire (a day, per netlify.toml), never renamed.
//
// Reads frontmatter directly rather than going through Eleventy: the only
// fields it needs are title and topic, and a 20-line parser here is cheaper
// than making the build depend on a browser.

const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = path.join(__dirname, '..');
const site = require('../src/_data/site.json'); // #216: the card footer used to hard-code the tagline, so it drifted the moment site.json changed.
const SRC = path.join(ROOT, 'src', 'resources');
const OUT = path.join(ROOT, 'src', 'assets', 'img', 'og');
const SITE_CARD = path.join(ROOT, 'src', 'assets', 'img', 'og.png');
// #450: what the committed PNGs were last rendered FROM. A string baked into a
// bitmap is invisible to grep and to every check in this repo, which is how the
// sitewide card went on saying "Your AI pre-sales team" for six days after #168
// retired it. This manifest is the bitmaps' text, written out so
// test/assets.test.js can hold it against site.json and the articles' own
// frontmatter — and fail, naming `npm run og`, the moment they disagree.
const MANIFEST = path.join(ROOT, 'data', 'og-cards.json');
const FONTS = path.join(ROOT, 'src', 'assets', 'fonts');

// Minimal frontmatter read: the block between the first two `---` lines.
function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    // Strip one layer of quotes, and the backslash-escapes a quoted YAML
    // scalar can carry (titles here contain escaped double quotes).
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).replace(/\\"/g, '"');
    }
    out[kv[1]] = v;
  }
  return out;
}

// Exported so the test can read the same titles this renderer reads, rather
// than a second parser drifting from this one.
module.exports = { frontmatter };

const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fontFace = (family, file, weight) => `
  @font-face {
    font-family: '${family}';
    src: url('file://${path.join(FONTS, file)}') format('woff2');
    font-weight: ${weight};
    font-display: block;
  }`;

function card({ title, topic }) {
  // Long titles get a smaller face rather than an overflowing box.
  const n = title.length;
  const size = n > 78 ? 52 : n > 58 ? 60 : n > 40 ? 68 : 76;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fontFace('Jakarta', 'plus-jakarta-sans-latin.woff2', '200 800')}
    ${fontFace('Mono', 'jetbrains-mono-latin.woff2', '100 800')}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1200px; height: 630px; display: flex; flex-direction: column;
      justify-content: space-between; padding: 72px 80px;
      background: #1A1A18; color: #fff;
      font-family: 'Jakarta', sans-serif; overflow: hidden;
    }
    /* One emerald bleed in the corner — the site's accent, used once. */
    .glow {
      position: absolute; right: -180px; top: -180px;
      width: 620px; height: 620px; border-radius: 50%;
      background: radial-gradient(circle, rgba(0,179,126,0.30) 0%, rgba(0,179,126,0) 70%);
    }
    .top { display: flex; align-items: center; gap: 12px; position: relative; }
    .mark {
      width: 40px; height: 40px; border-radius: 11px; background: #fff;
      display: flex; align-items: center; justify-content: center;
    }
    .mark svg { width: 24px; height: 24px; }
    .word { font-size: 25px; font-weight: 800; letter-spacing: -0.02em; }
    .topic {
      font-family: 'Mono', monospace; font-size: 17px; letter-spacing: 0.14em;
      text-transform: uppercase; color: #00B37E; margin-left: auto;
    }
    h1 {
      font-size: ${size}px; font-weight: 800; line-height: 1.1;
      letter-spacing: -0.035em; max-width: 20ch; position: relative;
    }
    .foot {
      display: flex; align-items: center; justify-content: space-between;
      font-family: 'Mono', monospace; font-size: 19px; color: #8F8F8A;
      border-top: 1px solid rgba(255,255,255,0.14); padding-top: 26px;
    }
    .foot .url { color: #EDEAE3; }
  </style></head><body>
    <div class="glow"></div>
    <div class="top">
      <div class="mark"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6C2 3.79 3.79 2 6 2s4 1.79 4 4-1.79 4-4 4" stroke="#1A1A18" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="6" r="1.2" fill="#1A1A18"/></svg></div>
      <span class="word">Prospektor</span>
      <span class="topic">${esc(topic || 'lead generation')}</span>
    </div>
    <h1>${esc(title)}</h1>
    <div class="foot">
      <span class="url">prospektor.ai/resources</span>
      <span>${esc(site.tagline)}</span>
    </div>
  </body></html>`;
}

/**
 * The sitewide card — what unfurls for prospektor.ai itself and for every page
 * that has not been given one of its own.
 *
 * Light where the article cards are dark, so a link to the product and a link
 * to a post are told apart at a glance in a feed. Every string on it is read
 * from site.json or stated once here; nothing is transcribed, which is the
 * whole point of moving it into this file.
 */
function siteCard() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fontFace('Jakarta', 'plus-jakarta-sans-latin.woff2', '200 800')}
    ${fontFace('Mono', 'jetbrains-mono-latin.woff2', '100 800')}
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1200px; height: 630px; display: flex; flex-direction: column;
      justify-content: space-between; padding: 72px 80px;
      background: #F5F3EF; color: #1A1A18;
      font-family: 'Jakarta', sans-serif; overflow: hidden;
    }
    .top { display: flex; align-items: center; gap: 12px; }
    .mark {
      width: 40px; height: 40px; border-radius: 11px; background: #1A1A18;
      display: flex; align-items: center; justify-content: center;
    }
    .mark svg { width: 24px; height: 24px; }
    .word { font-size: 25px; font-weight: 800; letter-spacing: -0.02em; }
    .word .dot { color: #00B37E; }
    h1 {
      font-size: 74px; font-weight: 800; line-height: 1.06;
      letter-spacing: -0.038em; max-width: 15ch;
    }
    h1 .accent { color: #00B37E; }
    /* #453: the two questions ride above the headline here exactly as they ride
       in the hero's tag pill — the card is the hero in picture form, and a card
       showing a headline the page no longer has is the drift data/og-cards.json
       and test/assets.test.js exist to catch. */
    .frame {
      display: block; font-family: 'Mono', monospace; font-size: 19px;
      letter-spacing: 0.06em; color: #8F8F8A; margin-bottom: 18px;
    }
    p {
      font-size: 27px; line-height: 1.45; color: #55554F;
      max-width: 30ch; margin-top: 26px;
    }
    .foot {
      display: flex; align-items: center; gap: 14px;
      font-family: 'Mono', monospace; font-size: 19px; color: #8F8F8A;
    }
    .foot .price { color: #1A1A18; }
    .foot .dot { color: #00B37E; font-size: 15px; }
  </style></head><body>
    <div class="top">
      <div class="mark"><svg viewBox="0 0 12 12" fill="none"><path d="M2 6C2 3.79 3.79 2 6 2s4 1.79 4 4-1.79 4-4 4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="6" r="1.2" fill="#fff"/></svg></div>
      <span class="word">Prospektor<span class="dot">.</span></span>
    </div>
    <div>
      <span class="frame">Who to pitch. What to send.</span>
      <h1>Find Leads.<br><span class="accent">That fit you.</span></h1>
      <p>${esc(TAGLINE_LINE)}</p>
    </div>
    <div class="foot">
      <span class="dot">&#9679;</span><span class="price">$999</span>
      <span>/ month &nbsp;·&nbsp; per workspace</span>
    </div>
  </body></html>`;
}

/**
 * The sentence under the headline. #450: it is the hero's own promise, cut to
 * what fits a card at 27px — not site.description, which is written to a
 * 160-character search-snippet budget and reads as a meta tag when it is set
 * this large. The tagline is appended so the one string every other surface
 * shows is on the picture too.
 */
const TAGLINE_LINE =
  `Teach it what you're after in three minutes — customers, partners, `
  + `resellers, investors. Then it finds them, and writes what you send.`;

(async () => {
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.md'));
  if (!files.length) { console.log('no articles'); return; }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

  await page.setContent(siteCard(), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: SITE_CARD });
  console.log('  wrote', 'src/assets/img/og.png (sitewide)');

  let n = 0;
  const articles = {};
  for (const file of files) {
    const fm = frontmatter(path.join(SRC, file));
    if (!fm || !fm.title) { console.log('  skip (no frontmatter title):', file); continue; }
    const slug = file.replace(/\.md$/, '');
    articles[slug] = fm.title;
    await page.setContent(card(fm), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, `${slug}.png`) });
    console.log('  wrote', `src/assets/img/og/${slug}.png`);
    n++;
  }

  await browser.close();

  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify({
    '//': 'Written by tools/og.js (#450). What the committed OG PNGs actually say. '
      + 'Held against src/_data/site.json and the articles\' frontmatter by test/assets.test.js — '
      + 'if that test is red, the pictures have drifted from the words: run `npm run og`.',
    tagline: site.tagline,
    siteLine: TAGLINE_LINE,
    articles,
  }, null, 2) + '\n');
  console.log('  wrote', 'data/og-cards.json');

  console.log(`${n} card${n === 1 ? '' : 's'}`);
})();
