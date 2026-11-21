// Penalty: data loading plus the two views (Today card, Summary calendar). Rules and maths are in penalty.js.
import { sb, cachedRows, pending } from './db.js';
import { overlay } from './overlay.js';
import { esc } from './ui.js';
import { PENALTY_START, PENALTY_METRICS, penaltySummary, todayLine, monthCells, addMonth, monthName, dayDetail, inr } from './penalty.js';

// One page is 1000 rows (server cap), so read pages until a short one comes back.
const paged = async () => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('readings').select('user_id,metric,slot_date,slot,deleted_at').gte('slot_date', PENALTY_START)
      .in('metric', PENALTY_METRICS).is('deleted_at', null).order('slot_date').order('id').range(from, from + 999);
    if (error) return { error };
    out.push(...data);
    if (data.length < 1000) return { data: out };
  }
};

// Server rows (or the phone's copy), with queued offline writes and `extra` rows (Today's own, incl. unsent) laid on top.
export async function loadPenaltyRows(first = false, extra = []) {
  const rows = await cachedRows('penalty:rows', { then: (ok, no) => paged().then(ok, no) }, first) // lazy: nothing is sent offline or on the cache-first pass;
  const ops = [...await pending(), ...extra.map(row => ({ table: 'readings', kind: 'upsert', row }))];
  return overlay(rows, ops, 'readings').filter(r => !r.deleted_at && r.slot_date >= PENALTY_START);
}

export const cardHtml = s => `<div class="pen-top"><div><b class="num">${inr(s.total)}</b><span>owed</span></div>
    <div><b class="num">${s.count}</b><span>${s.count === 1 ? 'penalty day' : 'penalty days'}</span></div></div>
  <p class="pen-line">${esc(todayLine(s))}</p>`;

const LEGEND = [['done', 'Clean'], ['skipped', 'Penalty'], ['none', 'Pending or not yet']];
const CLS = { clean: 'done', penalty: 'skipped', pending: 'none today', none: 'none off' };

// Summary calendar: month navigation, tap a day for what was missing. Returns repaint(rows).
export function mountPenaltyCalendar(el) {
  let rows = [], s, month = null, picked = null;
  const paint = () => {
    s = penaltySummary(rows);
    const cur = s.today.slice(0, 7), lo = PENALTY_START.slice(0, 7);
    month ??= cur < lo ? lo : cur;
    const heads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${d}</span>`).join('');
    const cells = monthCells(month, s.idx, s.today).map(c => c
      ? `<button type="button" class="cell" data-pday="${c.day}" aria-label="${esc(dayDetail(s.idx, c.day, s.today))}"><span class="d ${CLS[c.state]}${picked === c.day ? ' picked' : ''}">${c.n}</span></button>`
      : '<span></span>').join('');
    el.innerHTML = `<div class="pen-nav"><button type="button" class="nav" data-pmonth="-1" aria-label="Previous month" ${month <= lo ? 'disabled' : ''}>‹</button>
        <h3>${monthName(month)}</h3>
        <button type="button" class="nav" data-pmonth="1" aria-label="Next month" ${month >= cur ? 'disabled' : ''}>›</button></div>
      <div class="heat-head">${heads}</div><div class="pen-grid">${cells}</div>
      <div class="legend">${LEGEND.map(([k, t]) => `<span><i class="${k}"></i>${t}</span>`).join('')}</div>
      <p class="pen-detail" role="status">${picked ? esc(dayDetail(s.idx, picked, s.today)) : `${s.count} ${s.count === 1 ? 'penalty day' : 'penalty days'} so far, ${inr(s.total)}. Tap a day for details.`}</p>`;
  };
  el.onclick = e => {
    const m = e.target.closest('[data-pmonth]'), d = e.target.closest('[data-pday]');
    if (m && !m.disabled) (month = addMonth(month, +m.dataset.pmonth)), (picked = null), paint();
    if (d) (picked = d.dataset.pday), paint();
  };
  return r => ((rows = r), paint());
}
