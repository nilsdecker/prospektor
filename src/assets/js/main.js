// ── SCROLL REVEAL ──
const obs = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
}), { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

// ── TYPEWRITER HERO ──
const phrases = [
  'landing page',
  'resource hub',
  'lead-gen machine',
  'outbound engine',
  'GTM playbook',
  'AI-powered hub',
];

const dynEl = document.getElementById('dynText');
const enterKey = document.getElementById('enterKey');
const buildStatus = document.getElementById('buildStatus');
const buildMsg = document.getElementById('buildMsg');

const buildMsgs = [
  'Initializing AI brain...',
  'Generating pages...',
  'Wiring email sequences...',
  'Building outbound engine...',
  'Deploying to Netlify...',
  'Pipeline live ✓',
];

let phraseIdx = 0, charIdx = 0, deleting = false, building = false, buildMsgIdx = 0;

function typeWriter() {
  if (building) return;

  const phrase = phrases[phraseIdx];

  if (!deleting) {
    dynEl.textContent = phrase.slice(0, ++charIdx);
    if (charIdx === phrase.length) {
      // Pause, flash enter key, then "build"
      setTimeout(() => {
        enterKey.style.background = 'var(--accent)';
        enterKey.style.color = 'white';
        building = true;
        buildStatus.classList.add('active');
        buildMsgIdx = 0;
        buildMsg.textContent = buildMsgs[0];

        let msgTimer = setInterval(() => {
          buildMsgIdx++;
          if (buildMsgIdx < buildMsgs.length) {
            buildMsg.textContent = buildMsgs[buildMsgIdx];
          } else {
            clearInterval(msgTimer);
            setTimeout(() => {
              buildStatus.classList.remove('active');
              enterKey.style.background = '';
              enterKey.style.color = '';
              building = false;
              deleting = true;
              phraseIdx = (phraseIdx + 1) % phrases.length;
              setTimeout(typeWriter, 56);
            }, 420);
          }
        }, 350);
      }, 420);
      return;
    }
    setTimeout(typeWriter, 49);
  } else {
    dynEl.textContent = phrase.slice(0, --charIdx);
    if (charIdx === 0) {
      deleting = false;
      setTimeout(typeWriter, 140);
    } else {
      setTimeout(typeWriter, 27);
    }
  }
}

setTimeout(typeWriter, 800);

// ── BUILD ANIMATION ──
const lines = document.querySelectorAll('.cl');
const bFill = document.getElementById('bFill');
const buildPct = document.getElementById('buildPct');
const buildLbl = document.getElementById('buildLbl');
const statIds = ['bst1','bst2','bst3','bst4','bst5'];

const stages = [
  { lines: [0,1,2,3], pct: 20, stat: 0, label: 'Building brain...' },
  { lines: [5,6,7],   pct: 45, stat: 1, label: 'Generating pages...' },
  { lines: [9,10,11], pct: 68, stat: 2, label: 'Wiring email...' },
  { lines: [13,14,15],pct: 90, stat: 3, label: 'Building outbound...' },
  { lines: [],        pct: 100, stat: 4, label: 'Done ✓' },
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
  buildLbl.textContent = 'Building...';
  stageIdx = 0; lineIdx = 0;
}

function runStage() {
  if (stageIdx >= stages.length) {
    // mark last stat done, then restart
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
  if (es[0].is