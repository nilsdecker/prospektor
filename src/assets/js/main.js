// ── SCROLL REVEAL ──
const obs = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
}), { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

// ── BUILD ANIMATION ──
const lines = document.querySelectorAll('.cl');
const bFill = document.getElementById('bFill');
const buildPct = document.getElementById('buildPct');
const buildLbl = document.getElementById('buildLbl');
const statIds = ['bst1','bst2','bst3','bst4','bst5','bst6'];

// The six stages of a real run: understand, research, score, draft, people, check.
const stages = [
  { lines: [0,1],        pct: 18,  stat: 0, label: 'Understanding the target...' },
  { lines: [2],          pct: 34,  stat: 1, label: 'Researching...' },
  { lines: [3,4],        pct: 46,  stat: 2, label: 'Scoring fit...' },
  { lines: [5,6,7,8],    pct: 68,  stat: 3, label: 'Drafting in your voice...' },
  { lines: [9,10,11,12], pct: 86,  stat: 4, label: 'Finding decision-makers...' },
  { lines: [13,14,15],   pct: 100, stat: 5, label: 'Checking the draft...' },
];

let stageIdx = 0;
let lineIdx = 0;
let running = false;

function resetBuild() {
  lines.forEach(l => l.classList.remove('show'));
  statIds.forEach(id => {
    const el = document.getElementById(id);
    el.className = 'bstat';
  });
  bFill.style.width = '0%';
  buildPct.textContent = '0%';
  buildLbl.textContent = 'Running...';
  stageIdx = 0; lineIdx = 0;
}

function runStage() {
  if (stageIdx >= stages.length) {
    // mark last stat done, then restart
    buildLbl.textContent = 'Pitch ready ✓';
    statIds.forEach(id => {
      const el = document.getElementById(id);
      el.className = 'bstat done';
    });
    setTimeout(() => { resetBuild(); runStage(); }, 3500);
    return;
  }

  const stage = stages[stageIdx];
  buildLbl.textContent = stage.label;
  bFill.style.width = stage.pct + '%';
  buildPct.textContent = stage.pct + '%';

  // Mark previous stats done, current active
  for (let i = 0; i < statIds.length; i++) {
    const el = document.getElementById(statIds[i]);
    if (i < stage.stat) el.className = 'bstat done';
    else if (i === stage.stat) el.className = 'bstat active';
    else el.className = 'bstat';
  }

  // Reveal lines one by one
  function showNextLine() {
    if (lineIdx < stage.lines.length) {
      lines[stage.lines[lineIdx]].classList.add('show');
      lineIdx++;
      setTimeout(showNextLine, 320);
    } else {
      stageIdx++;
      lineIdx = 0;
      setTimeout(runStage, 900);
    }
  }
  showNextLine();
}

// Start when card scrolls into view
const cardObs = new IntersectionObserver(es => {
  if (es[0].isIntersecting && !running) {
    running = true;
    runStage();
    cardObs.disconnect();
  }
}, { threshold: 0.3 });

const card = document.querySelector('.build-card');
if (card) cardObs.observe(card);