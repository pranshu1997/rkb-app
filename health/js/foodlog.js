// Food log: calories and nutrients per meal, inside the Meals flow on Today.
// Meal sheet -> "Add food" -> search (recent and often-eaten first) -> amount -> saved entry listed in that meal.
// Nutrients are stored on each entry (js/nutrition.js maths), so totals never depend on the food database version.
import { sb, upsert, patch, cachedRows, pending } from './db.js';
import { overlay } from './overlay.js';
import { localDate } from './slots.js';
import { esc, hhmm, toast, buzz } from './ui.js';
import { ICONS } from './icons.js';
import { targets, stored, loadTargets, saveTargets, suggest, complete, ACTIVITY, GOALS, KEYS, LABEL, UNIT } from './targets.js';
import { unpack, search, entryFor, totals, portion, recents, vsTarget } from './nutrition.js';

export const FOOD_SECTION = `
  <h2 class="sec-h">Nutrition <span data-out="nut-sub">Calories, carbs and sugar</span></h2>
  <section class="vlist" data-out="nutrition"></section>`;
export const FOOD_SHEET = '<dialog id="food-sheet" class="sheet" aria-label="Add food"></dialog>';

const MEAL_NAME = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };
const num = n => Number(n).toLocaleString();
let ctx, root, sheet, sheetT, rows = [], day, loads = 0, warned = false, saving = Promise.resolve();
const inflight = new Set();
let foods = null, foodsLoad = null; // food database, fetched on first use (the service worker keeps it for offline)
let past = null; // recents(): {recent, often}
const v = { view: 'search', meal: null, q: '', food: null, si: 0, qty: 1, editing: null };

const loadFoods = () => (foodsLoad ??= fetch(new URL('./food-db.json', import.meta.url)).then(r => r.json()).then(d => (foods = unpack(d)))
  .catch(e => { foodsLoad = null; throw e; }));

export const mealRows = meal => rows.filter(r => r.meal_type === meal);
export const mealSummary = meal => {
  const t = totals(mealRows(meal));
  return mealRows(meal).length ? `${num(t.kcal)} kcal · ${t.carbs} g carbs · ${t.sugar} g sugar` : '';
};

// ctx: {uid, names, at() -> Date to record, by(row) -> " · by Pranshu", onChange()}
export function mountFood(el, c) {
  ctx = c;
  root = el;
  sheet = root.querySelector('#food-sheet');
  sheet.addEventListener('click', onSheetClick);
  sheet.addEventListener('input', onSheetInput);
  sheet.addEventListener('close', () => (v.food = null));
  root.querySelector('[data-out=meal-food]').addEventListener('click', e => {
    const edit = e.target.closest('[data-f-edit]')?.dataset.fEdit, del = e.target.closest('[data-f-del]')?.dataset.fDel;
    if (edit) openEdit(rows.find(r => r.id === edit));
    if (del) removeRow(rows.find(r => r.id === del));
  });
  // Lives on <body>, not in Today, because Settings opens it while the Today view is hidden.
  sheetT = document.getElementById('targets-sheet') ?? document.body.appendChild(Object.assign(document.createElement('dialog'), { id: 'targets-sheet', className: 'sheet', ariaLabel: 'Food targets' }));
  sheetT.addEventListener('click', onTargetsClick);
  sheetT.addEventListener('input', paintSuggestions);
  root.querySelector('[data-out=nutrition]').addEventListener('click', e => e.target.closest('[data-act=targets]') && openTargets());
  addEventListener('pulse:open-targets', openTargets); // Settings row
  addEventListener('pulse:targets', render);
  loadTargets(true).then(() => loadTargets());
  render();
  return { load, openAdd, paintMeal, rows: () => rows };
}

// ── Load (phone copy first, then the network) ────────────────────────────
export async function load(forDay, first = false) {
  day = forDay;
  const mine = ++loads; // reloads can finish out of order; only the newest paints
  try {
    const [got, queued] = await Promise.all([
      cachedRows(`food:day:${day}`, sb.from('food_log').select('*').eq('slot_date', day).is('deleted_at', null), first)
        .catch(e => { if (e.message === 'nocache') return []; throw e; }),
      pending(),
    ]);
    if (mine !== loads) return;
    rows = overlay(got, [...queued, ...inflight], 'food_log').filter(r => !r.deleted_at && r.slot_date === day)
      .sort((a, b) => a.eaten_at.localeCompare(b.eaten_at));
    changed();
  } catch (e) {
    console.error(e);
    if (!warned) (warned = true, toast(`Food log: ${e.message}`, 'bad')); // once, not on every 15 s poll
  }
}

function changed() {
  render();
  ctx.onChange();
}

// ── Today: totals against targets ────────────────────────────────────────
function render() {
  const t = totals(rows);
  const T = targets();
  const row = (icon, tint, name, value, unit, target, unitNote) => {
    const vs = vsTarget(value, target, unitNote);
    return `<div class="vrow done prog${vs.over ? ' lvl-high' : ''}" style="--progress:${Math.min(100, (value / target) * 100)}%">
      <span class="vic ${tint}" aria-hidden="true">${icon}</span>
      <span class="vtx"><span class="vname">${name}</span><span class="vnote">${vs.text} · target ${num(target)} ${unitNote}</span></span>
      <span class="vval"><b class="num">${num(value)}</b><small>${unitNote}</small></span></div>`;
  };
  root.querySelector('[data-out=nutrition]').innerHTML =
    row(ICONS.kcal, 'vic-kcal', 'Calories', t.kcal, 'kcal', T.kcal, 'kcal') +
    row(ICONS.carbs, 'vic-carbs', 'Carbs', t.carbs, 'g', T.carbs, 'g') +
    row(ICONS.sugar, 'vic-sugar', 'Sugar', t.sugar, 'g', T.sugar, 'g') +
    `<div class="vrow done"><span class="vic vic-diet" aria-hidden="true">${ICONS.food}</span>
      <span class="vtx"><span class="vname">Protein, fat, fibre</span>
      <span class="vnote">${t.protein} g protein · ${t.fat} g fat · ${t.fibre} g fibre</span></span></div>
    <button type="button" class="vrow done" data-act="targets"><span class="vic vic-diet" aria-hidden="true">${ICONS.food}</span>
      <span class="vtx"><span class="vname">Food targets</span><span class="vnote">${stored().kcal ? 'Set for Papa' : 'Using standard numbers'}</span></span><span class="chev" aria-hidden="true">›</span></button>`;
  root.querySelector('[data-out=nutrition]').classList.toggle('empty', !rows.length); // nothing logged: only the Food targets row shows
  root.querySelector('[data-out=nut-sub]').textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'item' : 'items'} logged` : 'Nothing logged';
  if (sheet.open && v.view === 'search') paintResults();
}

// ── Meal sheet: this meal's food entries ────────────────────────────────
export function paintMeal(meal) {
  const list = mealRows(meal);
  const t = totals(list);
  root.querySelector('[data-out=meal-food]').innerHTML = !list.length ? '' : `<div class="vlist food-items">${list.map(r => `
    <div class="vrow done frow${r.pending ? ' pending' : ''}">
      <button type="button" class="fmain" data-f-edit="${esc(r.id)}" aria-label="Change ${esc(r.name)}">
        <span class="vtx"><span class="vname">${esc(r.name)}</span>
        <span class="vnote">${esc(portion(r))} · ${Number(r.carbs)} g carbs · ${Number(r.sugar)} g sugar · ${hhmm(r.eaten_at)}${r.pending ? ' · saving…' : ''}${esc(ctx.by(r))}</span></span>
        <span class="vval"><b class="num">${Math.round(r.kcal)}</b><small>kcal</small></span></button>
      <button type="button" class="link bad" data-f-del="${esc(r.id)}" aria-label="Delete ${esc(r.name)}">Delete</button></div>`).join('')}
    <div class="vrow done frow ftotal"><span class="vtx"><span class="vname">${MEAL_NAME[meal]} total</span>
      <span class="vnote">${t.carbs} g carbs · ${t.sugar} g sugar · ${t.protein} g protein</span></span>
      <span class="vval"><b class="num">${num(t.kcal)}</b><small>kcal</small></span></div></div>`;
}

// ── Add / change sheet ─────────────────────────────────────────────────
export async function openAdd(meal) {
  Object.assign(v, { view: 'search', meal, q: '', editing: null, food: null });
  renderSheet();
  if (!sheet.open) sheet.showModal();
  loadPast();
  try { await loadFoods(); } catch { toast('Food list not available', 'bad'); }
  if (sheet.open && v.view === 'search') paintResults();
}

async function openEdit(r) {
  if (!r) return;
  try { await loadFoods(); } catch { return toast('Food list not available', 'bad'); }
  const f = foods.find(x => x.id === r.food_id);
  if (!f) return toast('This food is no longer in the list. Delete it and add it again.', 'bad');
  const si = Math.max(0, f.sv.findIndex(s => s[0] === r.unit));
  Object.assign(v, { view: 'pick', meal: r.meal_type, food: f, si, qty: Number(r.qty), editing: r });
  renderSheet();
  sheet.showModal();
}

async function loadPast() {
  try {
    const got = await cachedRows('food:recent', sb.from('food_log').select('food_id,name,unit,qty,created_at').is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(300));
    past = recents(got);
  } catch { past ??= { recent: [], often: [] }; }
  if (sheet.open && v.view === 'search') paintResults();
}

function renderSheet() {
  const name = MEAL_NAME[v.meal];
  if (v.view === 'search') {
    sheet.innerHTML = `<div class="sheet-head"><span></span><h2>Add to ${name}</h2><button type="button" class="link" data-f="close">Close</button></div>
      <input type="search" name="q" value="${esc(v.q)}" placeholder="Search food: roti, dal, chai" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search food">
      <div data-out="results"></div>`;
    paintResults();
    return;
  }
  const f = v.food;
  sheet.innerHTML = `<div class="sheet-head">${v.editing ? '<span></span>' : '<button type="button" class="link" data-f="back">Back</button>'}<h2>${name}</h2><button type="button" class="link" data-f="close">Close</button></div>
    <h3 class="pick-name">${esc(f.name)}</h3>
    <label class="when"><span>Serving</span><select name="serving" aria-label="Serving">${f.sv.map((s, i) =>
      `<option value="${i}"${i === v.si ? ' selected' : ''}>${esc(s[0])} (${s[1]} g)</option>`).join('')}</select></label>
    <div class="vlist"><div class="vrow done counter"><span class="vtx"><span class="vname">How many</span><span class="vnote" data-out="amount"></span></span>
      <span class="stepper"><button type="button" data-f="less" aria-label="Less">−</button><b class="num" data-out="qty"></b><button type="button" data-f="more" aria-label="More">+</button></span></div></div>
    <div class="vlist" data-out="preview"></div>
    <button type="button" class="save" data-f="add">${v.editing ? 'Save changes' : `Add to ${name}`}</button>`;
  paintPick();
}

function paintResults() {
  const box = sheet.querySelector('[data-out=results]');
  if (!box) return;
  const item = (f, hint) => {
    const e = entryFor(f, f.sv[0], 1);
    return `<button type="button" class="vrow frow" data-pick="${esc(f.id)}"${hint ? ` data-unit="${esc(hint.unit)}" data-qty="${hint.qty}"` : ''}>
      <span class="vtx"><span class="vname">${esc(f.name)}</span>
      <span class="vnote">${esc(e.unit)} (${e.grams} g): ${e.kcal} kcal · ${e.carbs} g carbs · ${e.sugar} g sugar</span></span><span class="chev" aria-hidden="true">›</span></button>`;
  };
  const group = (title, list) => (list.length ? `<h3 class="f-h">${title}</h3><div class="vlist food-list">${list.join('')}</div>` : '');
  if (!foods) return void (box.innerHTML = '<p class="muted center">Loading foods…</p>');
  if (v.q.trim()) {
    const hits = search(foods, v.q);
    box.innerHTML = hits.length ? `<div class="vlist food-list">${hits.map(f => item(f)).join('')}</div>`
      : `<p class="muted center">No food found for “${esc(v.q.trim())}”. Try another spelling or a shorter word.</p>`;
    return;
  }
  const byId = new Map(foods.map(f => [f.id, f]));
  const known = g => g.map(p => ({ p, f: byId.get(p.food_id) })).filter(x => x.f).map(x => item(x.f, x.p));
  box.innerHTML = group('Recent', known(past?.recent ?? [])) + group('Often eaten', known(past?.often ?? []))
    || '<p class="muted center">Type a food name above. Foods you add are shown here next time.</p>';
}

function paintPick() {
  const f = v.food, s = f.sv[v.si], e = entryFor(f, s, v.qty);
  sheet.querySelector('[data-out=qty]').textContent = v.qty;
  sheet.querySelector('[data-out=amount]').textContent = `${esc(portion({ unit: s[0], qty: v.qty }))} = ${e.grams} g`;
  const line = (name, val, unit, tint) => `<div class="vrow done frow"><span class="vtx"><span class="vname">${name}</span></span><span class="vval"><b class="num ${tint}">${num(val)}</b><small>${unit}</small></span></div>`;
  sheet.querySelector('[data-out=preview]').innerHTML = line('Calories', e.kcal, 'kcal') + line('Carbs', e.carbs, 'g') + line('Sugar', e.sugar, 'g') +
    `<div class="vrow done frow"><span class="vtx"><span class="vname">Protein · fat · fibre</span><span class="vnote">${e.protein} g · ${e.fat} g · ${e.fibre} g</span></span></div>`;
}

function onSheetInput(e) {
  if (e.target.name === 'q') (v.q = e.target.value, paintResults());
  if (e.target.name === 'serving') (v.si = Number(e.target.value), paintPick());
}

function onSheetClick(e) {
  const act = e.target.closest('[data-f]')?.dataset.f, pick = e.target.closest('[data-pick]');
  if (act === 'close') sheet.close();
  if (act === 'back') (v.view = 'search', renderSheet(), sheet.querySelector('[name=q]').focus());
  if (act === 'less') (v.qty = Math.max(0.5, v.qty - 0.5), paintPick());
  if (act === 'more') (v.qty = Math.min(20, v.qty + 0.5), paintPick());
  if (act === 'add') save();
  if (pick) {
    const f = foods.find(x => x.id === pick.dataset.pick);
    const si = f.sv.findIndex(s => s[0] === pick.dataset.unit);
    Object.assign(v, { view: 'pick', food: f, si: Math.max(0, si), qty: Number(pick.dataset.qty) || 1 });
    renderSheet();
  }
}

// ── Writes: the entry shows at once as "saving…"; the next load confirms it, or removes it if refused ──
function save() {
  const f = v.food, e = entryFor(f, f.sv[v.si], v.qty), old = v.editing;
  const at = old ? new Date(old.eaten_at) : ctx.at();
  const row = { id: old?.id ?? crypto.randomUUID(), user_id: ctx.uid, slot_date: old?.slot_date ?? localDate(at), meal_type: v.meal,
    eaten_at: at.toISOString(), food_id: f.id, name: f.name, ...e, deleted_at: null };
  buzz();
  sheet.close();
  write(row, 'Not saved');
}

function removeRow(r) {
  if (!r || !confirm(`Delete ${r.name}?`)) return;
  buzz();
  rows = rows.filter(x => x.id !== r.id);
  loads++;
  changed();
  const p = saving.catch(() => {}).then(() => patch('food_log', r.id, { deleted_at: new Date().toISOString() }));
  saving = p;
  p.catch(err => toast(err.message, 'bad')).finally(() => (past = null, load(day)));
}

function write(row, failure) {
  const op = { kind: 'upsert', table: 'food_log', row };
  inflight.add(op);
  rows = overlay(rows, [op], 'food_log').filter(r => !r.deleted_at && r.slot_date === day).sort((a, b) => a.eaten_at.localeCompare(b.eaten_at));
  loads++; // a load already in flight read the old state
  changed();
  const p = saving.catch(() => {}).then(() => upsert('food_log', row));
  saving = p;
  p.catch(e => toast(`${failure}: ${e.message}`, 'bad')).finally(() => (inflight.delete(op), (past = null), load(day)));
}

// ── Food targets screen: body profile, suggestions with reasons, editable numbers ──
const field = (name, label, attrs = '') => `<label class="trow"><span>${label}</span><input name="${name}" type="number" inputmode="decimal" autocomplete="off" placeholder="–" ${attrs}></label>`;
const pickRow = (name, label, opts) => `<label class="trow"><span>${label}</span><select name="${name}"><option value="">Choose</option>${opts.map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>`;

function openTargets() {
  const t = stored(), T = targets();
  sheetT.innerHTML = `<div class="sheet-head"><span></span><h2>Food targets</h2><button type="button" class="link" data-t="close">Close</button></div>
    <p class="t-warn"><b>Suggestion only.</b> Confirm with Papa’s doctor before relying on these numbers.</p>
    <h3 class="f-h">About Papa</h3>
    <div class="vlist tlist">
      ${field('height_cm', 'Height (cm)', 'min="80" max="250"')}${field('weight_kg', 'Weight (kg)', 'min="20" max="300"')}${field('age', 'Age', 'min="1" max="120"')}
      ${pickRow('sex', 'Sex', [['male', 'Male'], ['female', 'Female']])}
      ${pickRow('activity', 'Activity', Object.entries(ACTIVITY).map(([k, a]) => [k, a[0]]))}
      ${pickRow('goal', 'Goal', Object.entries(GOALS).map(([k, g]) => [k, g[3]]))}
      ${pickRow('diabetes', 'Diabetes', [['yes', 'Yes'], ['no', 'No']])}
    </div>
    <h3 class="f-h">Targets for each day</h3>
    <button type="button" class="ghost" data-t="all" disabled>Use all suggestions</button>
    <div class="vlist tlist">${KEYS.map(k => `<div class="trow-wrap" data-k="${k}">${field(k, `${LABEL[k]} (${UNIT[k]})`, 'min="0"')}
      <p class="t-why" data-out="why-${k}"></p></div>`).join('')}</div>
    <p class="muted t-foot">A number you type is kept. Suggestions never change it by themselves.</p>
    <button type="button" class="save" data-t="save">Save targets</button>`;
  for (const k of ['height_cm', 'weight_kg', 'age', 'sex', 'activity', 'goal']) (sheetT.querySelector(`[name=${k}]`).value = t[k] ?? '');
  sheetT.querySelector('[name=diabetes]').value = t.diabetes == null ? '' : t.diabetes ? 'yes' : 'no';
  for (const k of KEYS) sheetT.querySelector(`[name=${k}]`).value = T[k];
  paintSuggestions();
  sheetT.showModal();
}

const val = n => sheetT.querySelector(`[name=${n}]`).value;
function profile() {
  return { height_cm: val('height_cm') === '' ? null : Number(val('height_cm')), weight_kg: val('weight_kg') === '' ? null : Number(val('weight_kg')),
    age: val('age') === '' ? null : Number(val('age')), sex: val('sex') || null, activity: val('activity') || null, goal: val('goal') || null,
    diabetes: val('diabetes') === '' ? null : val('diabetes') === 'yes' };
}
function paintSuggestions() {
  const p = profile(), s = suggest({ ...p, diabetes: p.diabetes ?? false });
  const note = p.diabetes == null && s ? ' Diabetes not chosen: treated as no.' : '';
  for (const k of KEYS) {
    sheetT.querySelector(`[data-out=why-${k}]`).innerHTML = s
      ? `Suggested <b>${s[k][0].toLocaleString()} ${UNIT[k]}</b>. ${esc(s[k][1])}${k === 'kcal' ? esc(note) : ''}${Number(val(k)) === s[k][0] ? '' : ` <button type="button" class="link" data-t="use" data-k="${k}">Use ${s[k][0].toLocaleString()}</button>`}`
      : 'Fill in the profile above to see a suggestion.';
  }
  sheetT.querySelector('[data-t=all]').disabled = !s;
}

async function onTargetsClick(e) {
  const b = e.target.closest('[data-t]');
  if (!b) return;
  const act = b.dataset.t;
  if (act === 'close') sheetT.close();
  if (act === 'use' || act === 'all') {
    const p = profile(), s = suggest({ ...p, diabetes: p.diabetes ?? false });
    for (const k of act === 'all' ? KEYS : [b.dataset.k]) sheetT.querySelector(`[name=${k}]`).value = s[k][0];
    paintSuggestions();
  }
  if (act === 'save') {
    const fields = { ...profile(), ...Object.fromEntries(KEYS.map(k => [k, val(k) === '' ? null : Number(val(k))])) };
    const bad = [['height_cm', 80, 250, 'Height'], ['weight_kg', 20, 300, 'Weight'], ['age', 1, 120, 'Age'], ['kcal', 500, 6000, 'Calories'], ['carbs', 0, 800, 'Carbs'],
      ['sugar', 0, 400, 'Sugar'], ['protein', 0, 400, 'Protein'], ['fat', 0, 400, 'Fat'], ['fibre', 0, 200, 'Fibre']]
      .find(([k, lo, hi]) => fields[k] != null && !(fields[k] >= lo && fields[k] <= hi));
    if (bad) return toast(`${bad[3]} must be between ${bad[1]} and ${bad[2]}`, 'bad');
    b.disabled = true;
    try {
      await saveTargets(ctx.uid, fields);
      buzz();
      sheetT.close();
    } catch (err) {
      toast(`Not saved: ${err.message}`, 'bad');
    } finally {
      b.disabled = false;
    }
  }
}
