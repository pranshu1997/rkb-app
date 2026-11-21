// Penalty rule (Pranshu, 20261115): each calendar day (Asia/Kolkata) is checked the NEXT day. A day is a penalty day
// when any of blood pressure, sugar, steps or weight has no reading that day. Pure functions, so tests run in node.
import { METRIC_ALSO } from './config.js';

export const PENALTY_START = '2026-11-15';
export const PENALTY_RS = 10_000;
// [metric, short name, long name]. Steps also count when only minutes walked are logged (METRIC_ALSO).
export const PENALTY_ITEMS = [['bp', 'BP', 'blood pressure'], ['sugar', 'sugar', 'sugar'], ['steps', 'steps', 'steps'], ['weight', 'weight', 'weight']];
export const PENALTY_METRICS = ['bp', 'sugar', 'steps', 'walk_min', 'weight'];

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }); // en-CA prints YYYY-MM-DD
export const istDay = (now = new Date()) => fmt.format(now);

const ms = ymd => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const addDays = (ymd, n) => new Date(ms(ymd) + n * 86_400_000).toISOString().slice(0, 10);
export const compact = ymd => ymd.replaceAll('-', ''); // YYYYMMDD, how dates are shown as text
export const inr = n => `₹${n.toLocaleString('en-IN')}`;

// day -> Set of metrics logged that day. Deleted rows are ignored.
export function indexReadings(rows) {
  const idx = new Map();
  for (const r of rows) if (!r.deleted_at && PENALTY_METRICS.includes(r.metric)) (idx.get(r.slot_date) ?? idx.set(r.slot_date, new Set()).get(r.slot_date)).add(r.metric);
  return idx;
}

// Items with no reading on that day, as PENALTY_ITEMS entries.
export const missingOn = (idx, ymd) => {
  const have = idx.get(ymd) ?? new Set();
  return PENALTY_ITEMS.filter(([m]) => !have.has(m) && !have.has(METRIC_ALSO[m]));
};

// 'none' = before the start or still in the future; 'pending' = today; else 'clean' or 'penalty'.
export function dayState(idx, ymd, today) {
  if (ymd < PENALTY_START || ymd > today) return 'none';
  if (ymd === today) return 'pending';
  return missingOn(idx, ymd).length ? 'penalty' : 'clean';
}

export function penaltySummary(rows, now = new Date()) {
  const idx = indexReadings(rows), today = istDay(now);
  const days = [];
  for (let d = PENALTY_START; d < today; d = addDays(d, 1)) if (missingOn(idx, d).length) days.push(d);
  const missing = missingOn(idx, today);
  return { idx, today, days, count: days.length, total: days.length * PENALTY_RS, todayMissing: missing, started: today >= PENALTY_START };
}

export function todayLine(s) {
  if (!s.started) return `Starts ${compact(PENALTY_START)}`;
  const rule = `Penalty: ${inr(PENALTY_RS)} if anything is missing at midnight.`;
  if (!s.todayMissing.length) return `${rule} All ${PENALTY_ITEMS.length} are filled today.`;
  return `${rule} Fill them before bedtime.`;
}

// Month grid cells for YYYY-MM: Monday-first, leading blanks as null.
// What is still unfilled today, in full words (the Today card's second line).

export function monthCells(ym, idx, today) {
  const first = `${ym}-01`, lead = (new Date(ms(first)).getUTCDay() + 6) % 7;
  const n = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).getUTCDate();
  return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => {
    const day = `${ym}-${String(i + 1).padStart(2, '0')}`;
    if (day < PENALTY_START) return null; // days before the penalty began are left blank
    return { day, n: i + 1, state: dayState(idx, day, today) };
  })];
}

export const addMonth = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
export const monthName = ym => new Date(ms(`${ym}-01`)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function dayDetail(idx, ymd, today) {
  const st = dayState(idx, ymd, today), d = compact(ymd);
  if (st === 'none') return ymd < PENALTY_START ? `${d}: before the penalty started` : `${d}: not here yet`;
  const miss = missingOn(idx, ymd);
  if (st === 'pending') return `${d}: pending, checked tomorrow. ${miss.length ? `Still missing ${miss.map(i => i[2]).join(', ')}.` : 'All filled so far.'}`;
  return st === 'clean' ? `${d}: clean, all ${PENALTY_ITEMS.length} filled` : `${d}: penalty ${inr(PENALTY_RS)}. Missing ${miss.map(i => i[2]).join(', ')}.`;
}
