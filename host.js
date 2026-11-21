// RKB window: one top bar (Health | Tasks | News + gear), one frame per section, one service worker.
// Switching sections shows another frame: nothing reloads, each section keeps its place. Sections load the first time they are opened.
// Food (Pulse feat/food) is a Health tab, so it needs no entry here.
(() => {
  const BASE = new URL('./', document.currentScript.src).pathname; // "/rkb/"
  const APPS = ['health', 'tasks', 'news'];
  // Lists lives inside Tasks (hash #lists, #l/<uuid>): the old #lists entry opens Tasks there.
  const NAV = ['health', 'tasks', 'news'];
  const de = document.documentElement;
  // Only this site may frame RKB (GitHub Pages cannot send frame-ancestors, and a meta tag is ignored).
  try { if (top !== self) void parent.document; } catch { de.hidden = true; return; }
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const json = (k, d) => { try { return JSON.parse(ls.get(k)) ?? d; } catch { return d; } };
  const lang = () => (json('rkb.lang', null) ?? ls.get('lang')) === 'hi' ? 'hi' : 'en';
  const T = {
    en: { health: 'Health', tasks: 'Tasks', news: 'News', settings: 'Settings', lists: 'Lists', places: 'Places' },
    hi: { health: 'स्वास्थ्य', tasks: 'काम', news: 'खबरें', settings: 'सेटिंग', lists: 'सूचियाँ', places: 'जगहें' },
  };
  const L = () => T[lang()];
  const frames = {};
  // Desktop layout (contract: ~/.claude/handoffs/ui-overhaul-20261116/rkb6-desktop-contract.md): window >= 1024px shows a left sidebar.
  const mq = matchMedia('(min-width: 1024px)');
  const layout = () => (mq.matches ? 'desktop' : 'phone');
  const setLayout = f => { try { const d = f.contentDocument.documentElement; d.dataset.layout = layout(); d.style.setProperty('--rkb-content-max', '1040px'); } catch {} };
  const syncLayout = () => { de.dataset.layout = layout(); for (const k in frames) setLayout(frames[k]); };
  mq.addEventListener('change', syncLayout);
  de.dataset.layout = layout();
  const applyTheme = () => {
    de.dataset.theme = json('rkb.theme', null) ?? ls.get('theme') ?? 'system';
    const dark = de.dataset.theme === 'dark' || (de.dataset.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  };
  applyTheme();
  // A change made in one section reaches every loaded section now, not at their next load.
  const applyAll = () => {
    applyTheme();
    for (const k in frames) try { const d = frames[k].contentDocument.documentElement; d.dataset.theme = de.dataset.theme; d.dataset.size = json('rkb.size', 'normal'); } catch {}
    for (const k in frames) setLayout(frames[k]);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  const GEAR = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

  // Sections get the bottom safe-area from here: some phones report 0 inside a frame.
  const sab = getComputedStyle(document.getElementById('rkb-probe')).paddingBottom || '0px';
  const bar = document.getElementById('rkb-bar'), box = document.getElementById('rkb-frames');
  const RKB = (window.RKB = { host: true, base: BASE, sab, applyTheme: applyAll, reload: () => location.reload() });

  
  bar.innerHTML = `<nav aria-label="RKB">${NAV.map(a => `<a href="#${a}" data-rkb-app="${a}">${L()[a]}</a>`).join('')}</nav>
    <button type="button" class="rkb-gear" aria-label="${L().settings}">${GEAR}</button>`;
  // Desktop sidebar: same sections as the top bar, Lists and Places under Tasks. CSS shows it only at >= 1024px.
  const side = document.getElementById('rkb-side');
  const SIDE = [['health'], ['tasks'], ['lists', 'tasks', '#lists'], ['places', 'tasks', '#places'], ['news']];
  side.innerHTML = `<div class="rkb-brand">RKB</div><nav aria-label="RKB">${SIDE.map(([k, , h]) => `<a href="#${k}" data-rkb-app="${k}"${h ? ' class="sub"' : ''}>${L()[k]}</a>`).join('')}</nav>
    <button type="button" class="rkb-gear rkb-side-set" aria-label="${L().settings}">${GEAR}<span>${L().settings}</span></button>`;
  let cur;

  function frameFor(a, hidden, hash = '') {
    if (frames[a]) return frames[a];
    const f = frames[a] = Object.assign(document.createElement('iframe'), { className: 'rkb-frame', title: L()[a], src: `${BASE}${a}/${hash}`, hidden });
    f.addEventListener('load', () => setLayout(f));
    box.append(f);
    navigator.serviceWorker?.ready.then(r => r.active?.postMessage({ app: a }));
    return f;
  }
  function show(a, hash = '') {
    let sub = null;
    if (a === 'lists' || a === 'places') { sub = a; a = 'tasks'; hash = hash || '#' + sub; }
    if (!APPS.includes(a)) a = 'health';
    if (cur && cur !== a) try { frames[cur].contentWindow.RKB?.closeSettings?.(); } catch {}
    const had = !!frames[a];
    frameFor(a, false, hash);
    if (had && hash) try { frames[a].contentWindow.location.hash = hash; } catch {}
    for (const k in frames) frames[k].hidden = k !== a;
    for (const l of document.querySelectorAll('[data-rkb-app]')) (l.dataset.rkbApp === (sub || a)) ? l.setAttribute('aria-current', 'page') : l.removeAttribute('aria-current');
    ls.set('rkbshell.last', a);
    de.dataset.app = a; cur = a;
    showViewer();
  }
  RKB.show = show;
  const onNav = e => {
    const l = e.target.closest('a[data-rkb-app]');
    if (l) {
      e.preventDefault();
      if (l.classList.contains('sub')) show(l.dataset.rkbApp);
      else if (l.dataset.rkbApp === cur) frames[cur]?.contentWindow.dispatchEvent(new Event('rkb:tab')); // same entry again: that section goes home
      else show(l.dataset.rkbApp);
    } else if (e.target.closest('.rkb-gear')) {
      try { frames[cur].contentWindow.RKB.openSettings(); } catch {}
    }
  };
  bar.addEventListener('click', onNav); side.addEventListener('click', onNav);
  // Keyboard: Alt+1 Health, Alt+2 Tasks, Alt+3 News (Alt+Option on Mac gives symbols, so match the physical key).
  addEventListener('keydown', e => {
    const a = e.altKey && !e.ctrlKey && !e.metaKey && NAV[+e.code.replace('Digit', '') - 1];
    if (a && /^Digit[1-3]$/.test(e.code)) { e.preventDefault(); show(a); }
  });

  // Log out of every section: each signs out inside its own frame, so its own cleanup (cache, queue, push) runs.
  RKB.logOutAll = async () => {
    // The section on screen signs out last: it re-renders to its login form, and requests still in flight must not refill its cache first.
    for (const a of ['health', 'tasks'].sort((x, y) => (x === cur) - (y === cur))) {
      const f = frameFor(a, a !== cur), t0 = Date.now();
      let r; while (!(r = f.contentWindow?.RKB)?.signOut) { if (Date.now() - t0 > 15000) return false; await new Promise(x => setTimeout(x, 150)); }
      if (!(await r.signOut().catch(() => false))) return false;
    }
    return true;
  };

  // Who is signed in? Health's profiles table says: role 'entry' is Papa, anyone else is a viewer (Pranshu, member).
  // Viewer bar only on Health. Papa's account starts on Large text (only while no size was ever chosen).
  const viewerEl = document.getElementById('rkb-viewer');
  let who = null;
  const showViewer = () => {
    const on = who?.viewer && cur === 'health';
    viewerEl.hidden = !on; de.classList.toggle('rkb-viewing', !!on);
    if (on) viewerEl.textContent = lang() === 'hi' ? `आप ${who.name} का दिन देख रहे हैं` : `You are viewing ${who.name}\u2019s day`;
  };
  async function whoAmI() {
    try {
      const P = await fetch(`${BASE}projects.json`).then(r => r.json()), h = P.health;
      const tok = JSON.parse(ls.get(`sb-${new URL(h.url).hostname.split('.')[0]}-auth-token`) || 'null');
      if (!tok?.access_token) return;
      const rows = await fetch(`${h.url}/rest/v1/profiles?select=id,role,display_name`, { headers: { apikey: h.key, authorization: `Bearer ${tok.access_token}` } }).then(r => r.json());
      const me = rows.find(p => p.id === tok.user?.id), owner = rows.find(p => p.role === 'entry');
      if (!me || !owner) return;
      who = { viewer: me.role !== 'entry', name: owner.display_name || 'Papa' };
      if (!who.viewer && ls.get('rkb.size') === null && !mq.matches) { ls.set('rkb.size', JSON.stringify('large')); applyAll(); }
      showViewer();
    } catch {}
  }
  whoAmI();
  addEventListener('storage', e => e.key?.endsWith('-auth-token') && whoAmI()); // signing in/out inside a frame
  RKB.whoAmI = whoAmI;

  const first = location.hash.slice(1).split('/')[0];
  if (first === 'lists' || first === 'l') show('tasks', '#' + location.hash.slice(1)); // old Lists links land in Tasks > Lists
  else show(APPS.includes(first) ? first : ls.get('rkbshell.last'));
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE, updateViaCache: 'none' }).catch(() => {});
  }
})();
