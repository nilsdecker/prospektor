// Per-article Open Graph cards for /resources/ (#144).
//
// Renders one 1200x630 PNG per article into src/assets/img/og/, using the
// site's own fonts and tokens so a shared link looks like the site rather than
// like a generic blog card.
//
// Run with `npm run og` after adding or retitling an article. Output is
// committed — the Netlify build must not need a browser, so this is a local
// authoring step, not a build step.
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

(async () => {
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.md'));
  if (!files.length) { console.log('no articles'); return; }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });

  let n = 0;
  for (const file of files) {
    const fm = frontmatter(path.join(SRC, file));
    if (!fm || !fm.title) { console.log('  skip (no frontmatter title):', file); continue; }
    const slug = file.replace(/\.md$/, '');
    await page.setContent(card(fm), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, `${slug}.png`) });
    console.log('  wrote', `src/assets/img/og/${slug}.png`);
    n++;
  }

  await browser.close();
  console.log(`${n} card${n === 1 ? '' : 's'}`);
})();
