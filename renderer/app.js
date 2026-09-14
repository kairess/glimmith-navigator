let saveData = null; // last "save" payload's `data` (see server/save-reader.mjs)
let view = { screen: 'windows', windowId: null };
let inPuzzle = false;

const el = {
  app: document.getElementById('app'),
  content: document.getElementById('content'),
  solvedCount: document.getElementById('solvedCount'),
  totalCount: document.getElementById('totalCount'),
  globalBar: document.getElementById('globalBar'),
  windowsPerfectedLabel: document.getElementById('windowsPerfectedLabel'),
  connStatus: document.getElementById('connStatus'),
  clock: document.getElementById('clock'),
  minimizeBtn: document.getElementById('minimizeBtn'),
};

let minimized = false;
el.minimizeBtn.addEventListener('click', () => {
  minimized = !minimized;
  el.app.classList.toggle('minimized', minimized);
  el.minimizeBtn.textContent = minimized ? '+' : '-';
  el.minimizeBtn.title = minimized ? 'Expand' : 'Minimize';
  window.navigatorAPI.setMinimized(minimized);
});

function updateClock() {
  const now = new Date();
  el.clock.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
updateClock();
setInterval(updateClock, 1000);

window.navigatorAPI.onState((payload) => {
  if (payload.type === 'save') {
    saveData = payload.data;
    el.connStatus.textContent = 'last updated ' + new Date(payload.updatedAt).toLocaleTimeString();
    render();
  } else if (payload.type === 'save-error') {
    el.connStatus.textContent = 'save read error: ' + payload.message;
  } else if (payload.type === 'gamestate') {
    inPuzzle = !!payload.inPuzzle;
    document.body.classList.toggle('hidden-in-puzzle', inPuzzle);
  }
});

function renderGlobalStats() {
  if (!saveData) return;
  el.solvedCount.textContent = saveData.totals.solved;
  el.totalCount.textContent = saveData.totals.total;
  const pct = saveData.totals.total > 0 ? (saveData.totals.solved / saveData.totals.total) * 100 : 0;
  el.globalBar.style.width = pct.toFixed(1) + '%';
  el.windowsPerfectedLabel.textContent =
    `${saveData.windowsPerfected} / ${saveData.windowCount} windows perfected · ${saveData.windowsOpened} opened`;
}

function windowStateClass(w) {
  if (!w.opened) return 'state-untouched';
  if (w.perfected) return 'state-perfect';
  if (w.solved > 0) return 'state-partial';
  return 'state-untouched';
}

function windowBadge(w) {
  if (!w.opened) return '🔒';
  if (w.perfected) return '◆';
  if (w.solved > 0) return '◈';
  return '○';
}

function renderWindowsList() {
  const frag = document.createDocumentFragment();
  if (!saveData || saveData.windows.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'No puzzles discovered yet in this save.';
    frag.appendChild(hint);
    el.content.replaceChildren(frag);
    return;
  }
  let lastZoneId = null;
  for (const w of saveData.windows) {
    if (w.zoneId !== lastZoneId) {
      lastZoneId = w.zoneId;
      const section = document.createElement('div');
      section.className = 'zone-section';
      section.textContent = w.zoneName;
      frag.appendChild(section);
    }

    const card = document.createElement('div');
    card.className = 'window-card' + (w.opened ? '' : ' locked');
    card.addEventListener('click', () => {
      view = { screen: 'detail', windowId: w.id };
      render();
    });

    const top = document.createElement('div');
    top.className = 'window-card-top';
    const left = document.createElement('div');
    left.innerHTML = `<span class="badge">${windowBadge(w)}</span><span class="window-name">${w.name}</span>`;
    const right = document.createElement('div');
    right.className = 'window-fraction';
    right.textContent = w.opened ? `${w.solved} / ${w.visibleTotal}` : `${w.total} locked`;
    top.append(left, right);

    const bar = document.createElement('div');
    bar.className = 'window-progress ' + windowStateClass(w);
    const fill = document.createElement('div');
    fill.className = 'window-progress-fill';
    fill.style.width = (w.visibleTotal > 0 ? (w.solved / w.visibleTotal) * 100 : 0) + '%';
    bar.appendChild(fill);

    card.append(top, bar);
    frag.appendChild(card);
  }
  el.content.replaceChildren(frag);
}

async function onLocateClick(btn, puzzleId) {
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Going';
  try {
    const res = await window.navigatorAPI.locate(puzzleId);
    btn.textContent = res.ok ? 'Sent' : 'Failed';
  } catch {
    btn.textContent = 'Failed';
  }
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = originalText;
  }, 1500);
}

function renderWindowDetail() {
  const w = saveData.windows.find((x) => x.id === view.windowId);
  if (!w) {
    view = { screen: 'windows' };
    render();
    return;
  }
  const frag = document.createDocumentFragment();

  const back = document.createElement('div');
  back.className = 'back-row';
  back.textContent = '← All Windows';
  back.addEventListener('click', () => {
    view = { screen: 'windows' };
    render();
  });
  frag.appendChild(back);

  const header = document.createElement('div');
  header.className = 'detail-header';
  header.innerHTML = w.opened
    ? `<div class="detail-title">${windowBadge(w)} ${w.name}</div>
       <div class="detail-sub">${w.zoneName} · ${w.solved} / ${w.visibleTotal} solved</div>`
    : `<div class="detail-title">${windowBadge(w)} ${w.name}</div>
       <div class="detail-sub">${w.zoneName} · not reached yet · ${w.total} puzzles locked</div>`;
  frag.appendChild(header);

  for (const p of w.puzzles) {
    const row = document.createElement('div');
    row.className = 'puzzle-row' + (p.solved ? ' solved' : '') + (p.locked ? ' locked' : '');
    const showHidden = p.hidden && !p.discovered;
    const icon = p.solved ? '✓' : p.locked ? '🔒' : showHidden ? '+' : p.discovered ? '○' : '?';
    const iconClass = p.solved ? 'puzzle-solved-icon' : 'puzzle-unsolved-icon';
    const tag = showHidden
      ? ' <span class="undiscovered-tag">likely hidden (Ruby-tier) — not marked on map until the ending</span>'
      : !p.discovered && !p.locked
      ? ' <span class="undiscovered-tag">not found yet</span>'
      : '';
    const label = document.createElement('div');
    label.className = 'puzzle-label';
    label.innerHTML = `<span class="${iconClass}">${icon}</span>#${p.number}${tag}`;
    const btn = document.createElement('button');
    btn.className = 'locate-btn';
    btn.textContent = 'Locate';
    btn.disabled = p.locked;
    btn.addEventListener('click', () => onLocateClick(btn, p.id));
    row.append(label, btn);
    frag.appendChild(row);
  }

  el.content.replaceChildren(frag);
}

function render() {
  renderGlobalStats();
  if (view.screen === 'detail' && saveData) renderWindowDetail();
  else renderWindowsList();
}

render();
