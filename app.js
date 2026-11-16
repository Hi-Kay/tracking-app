/* Tracker — areas with long-term phases, logged week by week.
   All data lives in localStorage (see KEY). No backend. */

const KEY = 'tracker.v1';
const COLORS = ['#d13a3f', '#d9600f', '#26875a', '#1f7ae0', '#7d45b8', '#0f8a8a'];
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
const weeksBetween = (a, b) => Math.round((b - a) / 6048e5);
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const fmt = (d, o = { day: 'numeric', month: 'short' }) => d.toLocaleDateString('en-GB', o);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

// ---------- state ----------
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.areas)) return s;
  } catch { /* fall through to empty state */ }
  return { version: 1, areas: [] };
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

let state = load();
const ui = { tab: 'week', weekOffset: 0 };
let draft = null; // area being edited in the dialog

// ---------- plan maths ----------
const totalWeeks = (a) => a.phases.reduce((n, p) => n + p.weeks, 0);
const planStart = (a) => monday(parse(a.start));

/** Where does `date` fall in this area's plan? */
function position(a, date) {
  const w = weeksBetween(planStart(a), monday(date)); // 0-based week index
  const total = totalWeeks(a);
  if (w < 0) return { status: 'upcoming', startsIn: -w, total };
  let acc = 0;
  for (let i = 0; i < a.phases.length; i++) {
    const p = a.phases[i];
    if (w < acc + p.weeks) {
      return {
        status: 'active', week: w + 1, total, phase: p, phaseIndex: i,
        phaseWeek: w - acc + 1, next: a.phases[i + 1], untilNext: acc + p.weeks - w,
      };
    }
    acc += p.weeks;
  }
  return { status: 'done', total, weeksAgo: w - total + 1 };
}
const countWeek = (a, mon) => {
  let n = 0;
  for (let i = 0; i < 7; i++) if (a.log[iso(addDays(mon, i))]) n++;
  return n;
};

// ---------- templates ----------
const TEMPLATES = {
  sport: {
    name: 'Sport', icon: '🏋️', color: COLORS[0], phases: [
      ['Build the routine', 4, 3, 'Show up 3× a week. Light weights, clean technique — consistency beats intensity.'],
      ['Increase weight', 4, 3, 'Add weight in small steps each week on the main lifts.'],
      ['Deload', 1, 2, 'Lighter week: reduce weight and let the body recover.'],
      ['Push further', 4, 4, 'Add a fourth session and keep progressing.'],
    ],
  },
  japanese: {
    name: 'Japanese', icon: '🇯🇵', color: COLORS[3], phases: [
      ['Daily habit', 4, 5, '15 minutes a day. Short sessions, never skip twice.'],
      ['Vocabulary & grammar', 6, 5, 'New words every session, one grammar point per week.'],
      ['Reading & listening', 6, 5, 'Short texts and audio at your level; keep reviews going.'],
      ['Review & consolidate', 2, 4, 'No new material. Repeat weak spots.'],
    ],
  },
  blank: { name: '', icon: '🎯', color: COLORS[2], phases: [['Phase 1', 4, 3, '']] },
};
function fromTemplate(key) {
  const t = TEMPLATES[key];
  return {
    id: uid(), name: t.name, icon: t.icon, color: t.color, start: iso(monday(today())),
    phases: t.phases.map(([name, weeks, target, focus]) => ({ id: uid(), name, weeks, target, focus })),
    log: {}, notes: {},
  };
}

// ---------- rendering: week ----------
function renderWeek() {
  const mon = addDays(monday(today()), ui.weekOffset * 7);
  const sun = addDays(mon, 6);
  const rel = ui.weekOffset === 0 ? 'This week'
    : ui.weekOffset === -1 ? 'Last week'
    : ui.weekOffset === 1 ? 'Next week'
    : ui.weekOffset < 0 ? `${-ui.weekOffset} weeks ago` : `In ${ui.weekOffset} weeks`;
  return `
    <section class="weeknav">
      <button class="icon-btn" data-act="week" data-d="-1" aria-label="Previous week">‹</button>
      <div class="weeknav-mid">
        <strong>${rel}</strong>
        <span>${fmt(mon)} – ${fmt(sun)} · CW ${isoWeek(mon)}</span>
      </div>
      <button class="icon-btn" data-act="week" data-d="1" aria-label="Next week">›</button>
    </section>
    ${ui.weekOffset !== 0 ? '<p class="center"><button class="link" data-act="week" data-d="0">Back to this week</button></p>' : ''}
    ${state.areas.length ? state.areas.map((a) => weekCard(a, mon)).join('') : emptyState()}
    ${state.areas.length ? '<p class="center"><button class="btn ghost" data-act="new">+ Add area</button></p>' : ''}`;
}

function emptyState() {
  return `
    <section class="card empty">
      <h2>What do you want to track?</h2>
      <p>An area is something you work on over many weeks — split into phases, so you always know what kind of week you are in.</p>
      <div class="row wrap">
        <button class="btn" data-act="new" data-tpl="sport">🏋️ Sport</button>
        <button class="btn" data-act="new" data-tpl="japanese">🇯🇵 Japanese</button>
        <button class="btn ghost" data-act="new" data-tpl="blank">Start blank</button>
      </div>
    </section>`;
}

function planBar(a, pos) {
  const total = pos.total;
  if (!total) return '';
  const segs = a.phases.map((p, i) => {
    const cls = pos.status === 'done' || (pos.status === 'active' && i < pos.phaseIndex) ? 'past'
      : pos.status === 'active' && i === pos.phaseIndex ? 'now' : 'future';
    return `<div class="seg ${cls}" style="flex:${p.weeks}" title="${esc(p.name)} · ${plural(p.weeks, 'week')}"><span>${esc(p.name)}</span></div>`;
  }).join('');
  const marker = pos.status === 'active'
    ? `<div class="marker" style="left:${((pos.week - 0.5) / total) * 100}%"></div>` : '';
  return `<div class="planbar">${segs}${marker}</div>`;
}

function weekCard(a, mon) {
  const pos = position(a, mon);
  const t = today();
  const count = countWeek(a, mon);
  const target = pos.phase?.target ?? 0;
  const met = target > 0 && count >= target;

  let head, body;
  if (pos.status === 'active') {
    head = `Week ${pos.week} of ${pos.total}`;
    const nextLine = pos.next
      ? `Next: <strong>${esc(pos.next.name)}</strong> in ${plural(pos.untilNext, 'week')}`
      : `Last phase — plan ends in ${plural(pos.untilNext, 'week')}`;
    body = `
      <div class="phase">
        <span class="chip">${esc(pos.phase.name)}</span>
        <span class="muted">week ${pos.phaseWeek} of ${pos.phase.weeks}</span>
      </div>
      ${pos.phase.focus ? `<p class="focus">${esc(pos.phase.focus)}</p>` : ''}
      ${planBar(a, pos)}
      <p class="next muted">${nextLine}</p>`;
  } else if (pos.status === 'upcoming') {
    head = 'Not started';
    body = `<p class="focus">Starts in ${plural(pos.startsIn, 'week')} (${fmt(planStart(a))}) with <strong>${esc(a.phases[0]?.name ?? '—')}</strong>.</p>${planBar(a, pos)}`;
  } else {
    head = pos.total ? 'Plan finished' : 'No plan yet';
    body = `<p class="focus">${pos.total ? `All ${plural(pos.total, 'week')} are done.` : 'This area has no phases.'}
      <button class="link" data-act="edit" data-id="${a.id}">Plan the next phase</button></p>${planBar(a, pos)}`;
  }

  const days = DAY_LETTERS.map((l, i) => {
    const d = addDays(mon, i);
    const key = iso(d);
    const cls = [a.log[key] ? 'on' : '', +d === +t ? 'today' : ''].join(' ');
    return `<button class="day ${cls}" data-act="toggle" data-id="${a.id}" data-date="${key}" ${d > t ? 'disabled' : ''}
      aria-pressed="${!!a.log[key]}" aria-label="${fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}">
      <small>${l}</small><b>${d.getDate()}</b></button>`;
  }).join('');

  return `
    <article class="card area" style="--c:${a.color}">
      <header class="area-head">
        <h2><span class="emoji">${esc(a.icon)}</span>${esc(a.name)}</h2>
        <span class="weekno">${head}</span>
        <button class="icon-btn small" data-act="edit" data-id="${a.id}" aria-label="Edit ${esc(a.name)}">✎</button>
      </header>
      ${body}
      <div class="days">${days}</div>
      <div class="tally ${met ? 'met' : ''}">
        ${target ? `${count} / ${target} sessions${met ? ' ✓' : ''}` : plural(count, 'session')}
      </div>
      <input class="note" data-note="${a.id}" data-week="${iso(mon)}" placeholder="Note for this week…"
        value="${esc(a.notes?.[iso(mon)] ?? '')}">
    </article>`;
}

// ---------- rendering: plan ----------
const COL = 34;

function renderPlan() {
  if (!state.areas.length) return emptyState();
  const thisMon = monday(today());
  let first = addDays(thisMon, -14);
  let last = addDays(thisMon, 12 * 7);
  for (const a of state.areas) {
    const s = planStart(a);
    const e = addDays(s, totalWeeks(a) * 7);
    if (s < first) first = s;
    if (e > last) last = addDays(e, 7);
  }
  const n = weeksBetween(first, last);
  const col = (d) => weeksBetween(first, d);

  let months = '', weeks = '';
  for (let i = 0; i < n; i++) {
    const d = addDays(first, i * 7);
    if (i === 0 || d.getDate() <= 7) {
      months += `<span style="left:${i * COL}px">${fmt(d, { month: 'short' })}${d.getMonth() === 0 || i === 0 ? ` ${d.getFullYear()}` : ''}</span>`;
    }
    weeks += `<span class="${+d === +thisMon ? 'cur' : ''}">${d.getDate()}</span>`;
  }

  const rows = state.areas.map((a) => {
    const s = planStart(a);
    const pos = position(a, today());
    let acc = 0, bars = '', cells = '';
    a.phases.forEach((p, i) => {
      const cls = pos.status === 'active' && pos.phaseIndex === i ? 'now' : '';
      bars += `<button class="bar ${cls}" data-act="edit" data-id="${a.id}" style="left:${(col(s) + acc) * COL}px;width:${p.weeks * COL - 3}px"
        title="${esc(p.name)} · ${plural(p.weeks, 'week')} · ${p.target}×/week${p.focus ? '\n' + esc(p.focus) : ''}"><span>${esc(p.name)}</span></button>`;
      for (let w = 0; w < p.weeks; w++) {
        const m = addDays(s, (acc + w) * 7);
        if (m > thisMon) break;
        const c = countWeek(a, m);
        const k = p.target && c >= p.target ? 'full' : c ? 'part' : 'none';
        cells += `<i class="${k}" style="left:${col(m) * COL}px" title="${fmt(m)}: ${c}${p.target ? ' / ' + p.target : ''}">${c || ''}</i>`;
      }
      acc += p.weeks;
    });
    return `
      <div class="r-label"><span>${esc(a.icon)} ${esc(a.name)}</span></div>
      <div class="r-track" style="--c:${a.color}">${bars}</div>
      <div class="r-cells" style="--c:${a.color}">${cells}</div>`;
  }).join('');

  return `
    <section class="card roadmap">
      <div class="road-scroll" id="road" data-today="${col(thisMon)}">
        <div class="road" style="width:${n * COL}px">
          <div class="today-band" style="left:${col(thisMon) * COL}px;width:${COL}px"></div>
          <div class="months">${months}</div>
          <div class="weeks">${weeks}</div>
          ${rows}
        </div>
      </div>
      <p class="legend muted">Columns are weeks (Monday date). Small squares: sessions logged —
        <i class="full"></i> target met <i class="part"></i> partly <i class="none"></i> none</p>
    </section>
    ${state.areas.map(planList).join('')}
    <p class="center"><button class="btn ghost" data-act="new">+ Add area</button></p>
    <section class="card backup">
      <h3>Backup</h3>
      <p class="muted">Everything is stored only in this browser. Export a file now and then to keep it safe or move it to another device.</p>
      <div class="row wrap">
        <button class="btn ghost" data-act="export">Export</button>
        <label class="btn ghost">Import<input type="file" id="import" accept="application/json" hidden></label>
      </div>
    </section>`;
}

function planList(a) {
  const pos = position(a, today());
  let d = planStart(a);
  const items = a.phases.map((p, i) => {
    const from = d, to = addDays(d, p.weeks * 7 - 1);
    d = addDays(d, p.weeks * 7);
    const now = pos.status === 'active' && pos.phaseIndex === i;
    return `
      <li class="${now ? 'now' : ''}">
        <div class="pl-head"><strong>${esc(p.name)}</strong>${now ? `<span class="chip">now · week ${pos.phaseWeek} of ${p.weeks}</span>` : ''}</div>
        <div class="muted">${fmt(from)} – ${fmt(to)} · ${plural(p.weeks, 'week')} · ${p.target}×/week</div>
        ${p.focus ? `<div class="pl-focus">${esc(p.focus)}</div>` : ''}
      </li>`;
  }).join('');
  return `
    <section class="card planlist" style="--c:${a.color}">
      <header class="area-head">
        <h2><span class="emoji">${esc(a.icon)}</span>${esc(a.name)}</h2>
        <span class="weekno">${plural(totalWeeks(a), 'week')} · until ${fmt(addDays(d, -1), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        <button class="btn ghost small" data-act="edit" data-id="${a.id}">Edit</button>
      </header>
      <ol>${items}</ol>
    </section>`;
}

function render() {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === ui.tab));
  $('#view').innerHTML = ui.tab === 'week' ? renderWeek() : renderPlan();
  const road = $('#road');
  if (road) road.scrollLeft = Math.max(0, (road.dataset.today - 2) * COL);
}

// ---------- editor ----------
function openEditor(area, isNew) {
  draft = structuredClone(area);
  draft.isNew = isNew;
  renderEditor();
  $('#editor').showModal();
}

function renderEditor() {
  const d = draft;
  const phases = d.phases.map((p, i) => `
    <fieldset class="ph">
      <div class="row">
        <span class="ph-no">${i + 1}</span>
        <input data-f="name" data-i="${i}" value="${esc(p.name)}" placeholder="Phase name" required>
        <button type="button" class="icon-btn small" data-eact="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
        <button type="button" class="icon-btn small" data-eact="down" data-i="${i}" ${i === d.phases.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
        <button type="button" class="icon-btn small" data-eact="del" data-i="${i}" aria-label="Remove phase">✕</button>
      </div>
      <div class="row">
        <label>Weeks <input type="number" min="1" max="104" data-f="weeks" data-i="${i}" value="${p.weeks}" required></label>
        <label>Sessions / week <input type="number" min="0" max="7" data-f="target" data-i="${i}" value="${p.target}" required></label>
      </div>
      <textarea data-f="focus" data-i="${i}" rows="2" placeholder="What is this phase about? (shown every week)">${esc(p.focus)}</textarea>
    </fieldset>`).join('');

  $('#editor').innerHTML = `
    <form id="edit-form">
      <h2>${d.isNew ? 'New area' : 'Edit area'}</h2>
      ${d.isNew ? `<div class="row wrap tpl"><span class="muted">Start from:</span>
        <button type="button" class="btn ghost small" data-eact="tpl" data-t="sport">🏋️ Sport</button>
        <button type="button" class="btn ghost small" data-eact="tpl" data-t="japanese">🇯🇵 Japanese</button>
        <button type="button" class="btn ghost small" data-eact="tpl" data-t="blank">Blank</button></div>` : ''}
      <div class="row">
        <label class="w-icon">Icon <input data-f="icon" value="${esc(d.icon)}" maxlength="4"></label>
        <label class="grow">Name <input data-f="name" value="${esc(d.name)}" placeholder="e.g. Sport" required></label>
      </div>
      <div class="row wrap">
        <label class="grow">Start date <input type="date" data-f="start" value="${d.start}" required></label>
        <div class="swatches" role="radiogroup" aria-label="Colour">
          ${COLORS.map((c) => `<button type="button" class="sw ${c === d.color ? 'on' : ''}" data-eact="color" data-c="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}
        </div>
      </div>
      <p class="hint muted">Weeks run Monday–Sunday. Week 1 is the week containing the start date.</p>
      <h3>Phases <span class="muted">· ${plural(totalWeeks(d), 'week')} in total</span></h3>
      ${phases}
      <button type="button" class="btn ghost" data-eact="add">+ Add phase</button>
      <footer class="row">
        ${d.isNew ? '' : '<button type="button" class="btn danger" data-eact="remove">Delete area</button>'}
        <span class="grow"></span>
        <button type="button" class="btn ghost" data-eact="cancel">Cancel</button>
        <button class="btn">Save</button>
      </footer>
    </form>`;
}

$('#editor').addEventListener('input', (e) => {
  const { f, i } = e.target.dataset;
  if (!f) return;
  const isNum = e.target.type === 'number';
  const v = isNum ? Number(e.target.value) : e.target.value;
  if (i !== undefined) draft.phases[i][f] = v; else draft[f] = v;
});

$('#editor').addEventListener('click', (e) => {
  const b = e.target.closest('[data-eact]');
  if (!b) return;
  const i = Number(b.dataset.i);
  const ph = draft.phases;
  switch (b.dataset.eact) {
    case 'add': ph.push({ id: uid(), name: `Phase ${ph.length + 1}`, weeks: 4, target: ph.at(-1)?.target ?? 3, focus: '' }); break;
    case 'del': ph.splice(i, 1); break;
    case 'up': [ph[i - 1], ph[i]] = [ph[i], ph[i - 1]]; break;
    case 'down': [ph[i + 1], ph[i]] = [ph[i], ph[i + 1]]; break;
    case 'color': draft.color = b.dataset.c; break;
    case 'tpl': draft = { ...fromTemplate(b.dataset.t), isNew: true }; break;
    case 'cancel': $('#editor').close(); return;
    case 'remove':
      if (!confirm(`Delete "${draft.name}" including everything logged for it?`)) return;
      state.areas = state.areas.filter((a) => a.id !== draft.id);
      save(); $('#editor').close(); render(); return;
  }
  renderEditor();
});

$('#editor').addEventListener('submit', (e) => {
  e.preventDefault();
  const { isNew, ...area } = draft;
  area.name = area.name.trim();
  area.icon = area.icon.trim() || '🎯';
  area.phases.forEach((p) => {
    p.weeks = Math.max(1, Math.round(p.weeks) || 1);
    p.target = Math.min(7, Math.max(0, Math.round(p.target) || 0));
  });
  if (isNew) state.areas.push(area);
  else state.areas = state.areas.map((a) => (a.id === area.id ? area : a));
  save(); $('#editor').close(); render();
});

// ---------- app events ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const area = state.areas.find((a) => a.id === b.dataset.id);
  switch (b.dataset.act) {
    case 'tab': ui.tab = b.dataset.tab; break;
    case 'week': ui.weekOffset = b.dataset.d === '0' ? 0 : ui.weekOffset + Number(b.dataset.d); break;
    case 'toggle':
      if (area.log[b.dataset.date]) delete area.log[b.dataset.date]; else area.log[b.dataset.date] = 1;
      save(); break;
    case 'new': openEditor(fromTemplate(b.dataset.tpl || 'blank'), true); return;
    case 'edit': openEditor(area, false); return;
    case 'export': exportData(); return;
  }
  render();
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.note) {
    const a = state.areas.find((x) => x.id === t.dataset.note);
    a.notes ??= {};
    if (t.value.trim()) a.notes[t.dataset.week] = t.value.trim(); else delete a.notes[t.dataset.week];
    save();
  } else if (t.id === 'import' && t.files[0]) {
    importData(t.files[0]);
  }
});

function exportData() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `tracker-${iso(today())}.json` });
  a.click();
  URL.revokeObjectURL(url);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.areas) || data.areas.some((a) => !a.id || !a.start || !Array.isArray(a.phases))) throw new Error('bad shape');
    if (state.areas.length && !confirm(`Replace the ${plural(state.areas.length, 'area')} in this browser with the ${data.areas.length} from the file?`)) return;
    data.areas.forEach((a) => { a.log ??= {}; a.notes ??= {}; });
    state = { version: 1, areas: data.areas };
    save(); render();
  } catch {
    alert('That file is not a Tracker export.');
  }
}

render();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
