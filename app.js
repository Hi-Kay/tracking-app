/* Tracker — areas with long-term phases and activity types, logged day by day.
   All data lives in localStorage (see KEY). No backend. */

const KEY = 'tracker.v1';
const COLORS = ['#d13a3f', '#d9600f', '#26875a', '#1f7ae0', '#7d45b8', '#0f8a8a'];
const TYPE_COLORS = ['#3fae5a', '#22b3c4', '#e08a2b', '#d9485f', '#7d5bd0', '#2f7de1', '#b59a1f', '#8a6d5a'];
const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const safeColor = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback);
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

// ---------- templates ----------
const TEMPLATES = {
  sport: {
    name: 'Sport', icon: '🏋️', color: COLORS[0],
    types: [['Strength', 'S', '#3fae5a'], ['Cardio', 'C', '#22b3c4'], ['Running', 'R', '#e08a2b'], ['Norwegian 4×4', '4×4', '#d9485f']],
    phases: [
      ['Build the routine', 4, 3, 'Show up 3× a week. Light weights, clean technique — find out which exercises you will do.'],
      ['Increase weight', 4, 3, 'Add weight in small steps each week on the main lifts.'],
      ['Deload', 1, 2, 'Lighter week: reduce weight and let the body recover.'],
      ['Push further', 4, 4, 'Add a fourth session and keep progressing.'],
    ],
  },
  japanese: {
    name: 'Japanese', icon: '🇯🇵', color: COLORS[3],
    types: [['Kana', 'か', '#d9485f'], ['Kanji', '漢', '#7d5bd0'], ['Vocabulary', 'V', '#2f7de1'], ['Grammar', 'G', '#3fae5a']],
    phases: [
      ['Daily habit', 4, 5, '15 minutes a day. Short sessions, never skip twice.'],
      ['Vocabulary & grammar', 6, 5, 'New words every session, one grammar point per week.'],
      ['Reading & listening', 6, 5, 'Short texts and audio at your level; keep reviews going.'],
      ['Review & consolidate', 2, 4, 'No new material. Repeat weak spots.'],
    ],
  },
  blank: { name: '', icon: '🎯', color: COLORS[2], types: [['Session', '✓', '#2f7de1']], phases: [['Phase 1', 4, 3, '']] },
};
const makeTypes = (list) => list.map(([name, short, color]) => ({ id: uid(), name, short, color }));
function fromTemplate(key) {
  const t = TEMPLATES[key];
  return {
    id: uid(), name: t.name, icon: t.icon, color: t.color, start: iso(monday(today())),
    types: makeTypes(t.types),
    phases: t.phases.map(([name, weeks, target, focus]) => ({ id: uid(), name, weeks, target, focus })),
    log: {}, notes: {},
  };
}

// ---------- state ----------
/** Bring any stored/imported data to the current shape (v2: log values are arrays of type ids). */
function normalize(s) {
  for (const a of s.areas) {
    a.log ??= {};
    a.notes ??= {};
    a.phases ??= [];
    a.color = safeColor(a.color, COLORS[0]);
    if (!Array.isArray(a.types) || !a.types.length) {
      // v1 areas had no types: borrow the matching template's, else a generic one
      const tpl = Object.values(TEMPLATES).find((t) => t.name && t.name.toLowerCase() === String(a.name).toLowerCase());
      a.types = makeTypes((tpl || TEMPLATES.blank).types);
    }
    a.types.forEach((t, i) => { t.color = safeColor(t.color, TYPE_COLORS[i % TYPE_COLORS.length]); });
    const ids = a.types.map((t) => t.id);
    for (const [d, v] of Object.entries(a.log)) {
      const arr = Array.isArray(v) ? ids.filter((id) => v.includes(id)) : v ? [ids[0]] : [];
      if (arr.length) a.log[d] = arr; else delete a.log[d];
    }
  }
  s.version = 2;
  return s;
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.areas)) return normalize(s);
  } catch { /* fall through to empty state */ }
  return { version: 2, areas: [] };
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

let state = load();
const ui = { tab: 'week', weekOffset: 0, overviewArea: null, scrollToCurrent: false };
let draft = null; // area being edited
let pick = null;  // { id, date } for the day picker

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
const typesOn = (a, date) => (a.log[date] || []).map((id) => a.types.find((t) => t.id === id)).filter(Boolean);
const countWeek = (a, mon) => {
  let n = 0;
  for (let i = 0; i < 7; i++) if (a.log[iso(addDays(mon, i))]) n++;
  return n;
};

/** Weeks in a row the target was met. This week counts once it is met; an unfinished week does not break it. */
function streak(a) {
  const thisMon = monday(today());
  const weekState = (m) => {
    const p = position(a, m);
    if (p.status !== 'active') return 'stop';
    if (!p.phase.target) return 'skip'; // rest weeks neither count nor break
    return countWeek(a, m) >= p.phase.target ? 'met' : 'miss';
  };
  let n = 0;
  for (let m = addDays(thisMon, -7); ; m = addDays(m, -7)) {
    const s = weekState(m);
    if (s === 'met') n++; else if (s !== 'skip') break;
  }
  if (weekState(thisMon) === 'met') n++;
  return n;
}

function toggleType(a, date, typeId) {
  const cur = a.log[date] || [];
  const next = cur.includes(typeId) ? cur.filter((x) => x !== typeId) : [...cur, typeId];
  const ordered = a.types.map((t) => t.id).filter((id) => next.includes(id));
  if (ordered.length) a.log[date] = ordered; else delete a.log[date];
  save();
}

// ---------- shared bits ----------
const tint = (c, pct = 50) => `color-mix(in oklab, ${c} ${pct}%, var(--surface))`;
function fill(ts) {
  if (!ts.length) return '';
  const step = 100 / ts.length;
  return `background:linear-gradient(90deg, ${ts.map((t, i) => `${tint(t.color)} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}
function dayBtn(a, d, inner) {
  const key = iso(d), t = today(), ts = typesOn(a, key);
  const label = fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }) + (ts.length ? `: ${ts.map((x) => x.name).join(', ')}` : '');
  return `<button class="day ${ts.length ? 'on' : ''} ${+d === +t ? 'today' : ''}" style="${fill(ts)}"
    data-act="toggle" data-id="${a.id}" data-date="${key}" ${d > t ? 'disabled' : ''} aria-label="${esc(label)}">
    ${inner}<em>${ts.map((x) => esc(x.short)).join(' ')}</em></button>`;
}
const typeChip = (t, extra = '') => `<span class="tchip" style="--t:${t.color}"><b>${esc(t.short)}</b>${extra}</span>`;
const streakTag = (a) => { const s = streak(a); return s ? `<span class="streak">🔥 ${plural(s, 'week')} in a row</span>` : ''; };

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
  if (!pos.total) return '';
  const segs = a.phases.map((p, i) => {
    const cls = pos.status === 'done' || (pos.status === 'active' && i < pos.phaseIndex) ? 'past'
      : pos.status === 'active' && i === pos.phaseIndex ? 'now' : 'future';
    return `<div class="seg ${cls}" style="flex:${p.weeks}" title="${esc(p.name)} · ${plural(p.weeks, 'week')}"><span>${esc(p.name)}</span></div>`;
  }).join('');
  const marker = pos.status === 'active'
    ? `<div class="marker" style="left:${((pos.week - 0.5) / pos.total) * 100}%"></div>` : '';
  return `<div class="planbar">${segs}${marker}</div>`;
}

function weekCard(a, mon) {
  const pos = position(a, mon);
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
    return dayBtn(a, d, `<small>${l}</small><b>${d.getDate()}</b>`);
  }).join('');

  // per-type breakdown, only meaningful with more than one type
  let breakdown = '';
  if (a.types.length > 1) {
    const by = {};
    for (let i = 0; i < 7; i++) typesOn(a, iso(addDays(mon, i))).forEach((t) => { by[t.id] = (by[t.id] || 0) + 1; });
    breakdown = a.types.filter((t) => by[t.id]).map((t) => typeChip(t, ` ${by[t.id]}`)).join('');
  }

  return `
    <article class="card area" style="--c:${a.color}">
      <header class="area-head">
        <h2><span class="emoji">${esc(a.icon)}</span>${esc(a.name)}</h2>
        <span class="weekno">${head}</span>
        <button class="icon-btn small" data-act="edit" data-id="${a.id}" aria-label="Edit ${esc(a.name)}">✎</button>
      </header>
      ${body}
      <div class="days">${days}</div>
      <div class="tally">
        <span class="${met ? 'met' : ''}">${target ? `${count} / ${target} sessions${met ? ' ✓' : ''}` : plural(count, 'session')}</span>
        ${breakdown}
        ${ui.weekOffset === 0 ? streakTag(a) : ''}
      </div>
      <input class="note" data-note="${a.id}" data-week="${iso(mon)}" placeholder="Note for this week…"
        value="${esc(a.notes?.[iso(mon)] ?? '')}">
    </article>`;
}

// ---------- rendering: overview (multi-week grid) ----------
function renderOverview() {
  if (!state.areas.length) return emptyState();
  const a = state.areas.find((x) => x.id === ui.overviewArea) || state.areas[0];
  const pills = state.areas.length > 1
    ? `<div class="area-pick">${state.areas.map((x) => `<button class="pill ${x === a ? 'on' : ''}" style="--c:${x.color}" data-act="ov" data-id="${x.id}">${esc(x.icon)} ${esc(x.name)}</button>`).join('')}</div>`
    : '';

  const start = planStart(a), total = totalWeeks(a), thisMon = monday(today());
  const n = Math.max(total, weeksBetween(start, thisMon) + 1);
  let rows = '', acc = 0;
  for (let w = 0; w < n; w++) {
    const mon = addDays(start, w * 7);
    const pos = position(a, mon);
    if (pos.status === 'active' && pos.phaseWeek === 1) {
      const p = pos.phase;
      rows += `<tr class="phase-row"><td colspan="9">
        <b>${esc(p.name)}</b> <span class="muted">· weeks ${acc + 1}–${acc + p.weeks} · ${p.target}×/week</span>
        ${p.focus ? `<div>${esc(p.focus)}</div>` : ''}</td></tr>`;
      acc += p.weeks;
    }
    if (w === total && total) rows += '<tr class="phase-row"><td colspan="9"><b>After the plan</b></td></tr>';

    const isCur = +mon === +thisMon, future = mon > thisMon;
    const count = countWeek(a, mon), target = pos.phase?.target ?? 0;
    const cells = DAY_SHORT.map((_, i) => `<td>${dayBtn(a, addDays(mon, i), '')}</td>`).join('');
    const cnt = future ? '' : target ? `${count}/${target}` : (count || '');
    rows += `
      <tr class="${isCur ? 'cur' : ''} ${future ? 'future' : ''}" ${isCur ? 'id="cur-week"' : ''}>
        <th scope="row"><button class="wk" data-act="goweek" data-mon="${iso(mon)}" title="Open this week">${w + 1}<small>${fmt(mon)}</small></button></th>
        ${cells}
        <td class="cnt ${target && count >= target ? 'met' : ''}">${cnt}</td>
      </tr>`;
    const note = a.notes?.[iso(mon)];
    if (note) rows += `<tr class="note-row"><td></td><td colspan="8">${esc(note)}</td></tr>`;
  }

  return `
    ${pills}
    <section class="card grid-card" style="--c:${a.color}">
      <header class="area-head">
        <h2><span class="emoji">${esc(a.icon)}</span>${esc(a.name)}</h2>
        ${streakTag(a)}
      </header>
      <div class="legend-types">${a.types.map((t) => typeChip(t, ` ${esc(t.name)}`)).join('')}</div>
      <table class="grid">
        <thead><tr><th class="wk-h">Wk</th>${DAY_SHORT.map((d) => `<th>${d}</th>`).join('')}<th class="cnt-h">✓</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
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
  $('#view').innerHTML = ui.tab === 'week' ? renderWeek() : ui.tab === 'overview' ? renderOverview() : renderPlan();
  const road = $('#road');
  if (road) road.scrollLeft = Math.max(0, (road.dataset.today - 2) * COL);
  if (ui.scrollToCurrent) {
    ui.scrollToCurrent = false;
    document.getElementById('cur-week')?.scrollIntoView({ block: 'center' });
  }
}

// ---------- day picker ----------
function openPicker(a, date) {
  pick = { id: a.id, date };
  renderPicker();
  $('#picker').showModal();
}
function renderPicker() {
  const a = state.areas.find((x) => x.id === pick.id);
  const on = a.log[pick.date] || [];
  $('#picker').innerHTML = `
    <form method="dialog">
      <h2>${fmt(parse(pick.date), { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
      <p class="muted">${esc(a.icon)} ${esc(a.name)} · what did you do?</p>
      <div class="types">
        ${a.types.map((t) => `
          <button type="button" class="type-tog ${on.includes(t.id) ? 'on' : ''}" style="--t:${t.color}"
            data-pact="t" data-t="${t.id}" aria-pressed="${on.includes(t.id)}">
            <b>${esc(t.short)}</b><span>${esc(t.name)}</span><span class="check">${on.includes(t.id) ? '✓' : ''}</span>
          </button>`).join('')}
      </div>
      <footer class="row">
        <button type="button" class="btn ghost" data-pact="clear" ${on.length ? '' : 'disabled'}>Clear day</button>
        <span class="grow"></span>
        <button class="btn">Done</button>
      </footer>
    </form>`;
}
$('#picker').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) { e.currentTarget.close(); return; } // backdrop
  const b = e.target.closest('[data-pact]');
  if (!b) return;
  const a = state.areas.find((x) => x.id === pick.id);
  if (b.dataset.pact === 't') toggleType(a, pick.date, b.dataset.t);
  else { delete a.log[pick.date]; save(); }
  renderPicker();
  render();
});

// ---------- editor ----------
function openEditor(area, isNew) {
  draft = structuredClone(area);
  draft.isNew = isNew;
  renderEditor();
  $('#editor').showModal();
}

function renderEditor() {
  const d = draft;
  const types = d.types.map((t, i) => `
    <div class="row trow">
      <input type="color" data-tf="color" data-i="${i}" value="${t.color}" aria-label="Colour">
      <input class="t-short" data-tf="short" data-i="${i}" value="${esc(t.short)}" maxlength="4" placeholder="S" required aria-label="Short label">
      <input class="t-name" data-tf="name" data-i="${i}" value="${esc(t.name)}" placeholder="e.g. Strength" required aria-label="Name">
      <button type="button" class="icon-btn small" data-eact="tdel" data-i="${i}" ${d.types.length === 1 ? 'disabled' : ''} aria-label="Remove type">✕</button>
    </div>`).join('');

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
      <h3>Activity types</h3>
      <p class="hint muted">What you can log on a day — e.g. Strength (S) and Cardio (C). A day can have several.</p>
      ${types}
      <button type="button" class="btn ghost small" data-eact="tadd">+ Add type</button>
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
  const { f, tf, i } = e.target.dataset;
  if (tf) { draft.types[i][tf] = e.target.value; return; }
  if (!f) return;
  const v = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
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
    case 'tadd':
      draft.types.push({ id: uid(), name: '', short: '', color: TYPE_COLORS[draft.types.length % TYPE_COLORS.length] });
      renderEditor();
      [...document.querySelectorAll('#editor .t-short')].at(-1).focus();
      return;
    case 'tdel': {
      const t = draft.types[i];
      const used = Object.values(draft.log).filter((v) => v.includes(t.id)).length;
      if (used && !confirm(`"${t.name || t.short}" is logged on ${plural(used, 'day')}. Remove it from those days too?`)) return;
      draft.types.splice(i, 1);
      break;
    }
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
  area.types.forEach((t) => { t.name = t.name.trim(); t.short = t.short.trim(); });
  area.phases.forEach((p) => {
    p.weeks = Math.max(1, Math.round(p.weeks) || 1);
    p.target = Math.min(7, Math.max(0, Math.round(p.target) || 0));
  });
  normalize({ areas: [area] }); // drops log entries of removed types
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
    case 'tab':
      ui.tab = b.dataset.tab;
      ui.scrollToCurrent = ui.tab === 'overview';
      break;
    case 'week': ui.weekOffset = b.dataset.d === '0' ? 0 : ui.weekOffset + Number(b.dataset.d); break;
    case 'goweek':
      ui.tab = 'week';
      ui.weekOffset = weeksBetween(monday(today()), parse(b.dataset.mon));
      window.scrollTo(0, 0);
      break;
    case 'ov': ui.overviewArea = b.dataset.id; ui.scrollToCurrent = true; break;
    case 'toggle':
      if (area.types.length === 1) { toggleType(area, b.dataset.date, area.types[0].id); break; }
      openPicker(area, b.dataset.date);
      return;
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
    state = normalize({ areas: data.areas });
    save(); render();
  } catch {
    alert('That file is not a Tracker export.');
  }
}

render();
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
