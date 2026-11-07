/* Pinboard · boot */
(function (PB) {
  'use strict';
  const WELCOME = [
    "# Welcome to your pinboard",
    "Paste anything: text becomes a **note**, a URL a **link**, an image a **screenshot**, long text or HTML a **doc**. Drop files too. Double-click the canvas for a note.",
    "",
    "- Drag a clip by its title strip. Drop it on another strip to **group**, on an app's drop zone to add it, on the dock to make it an app, to the right edge to **pin** it.",
    "- `◇` opens properties (tags, note, promote to a collection); on an app it shows the **params**.",
    "- `⌘K` quicklaunch · `⌘Z` undo · `⌘C`/`⌘V` copy clips between boards · `⌘G` group · `⌘P` pin · `n` note · `Tab` properties.",
    "- The **agent** (right) organises clips into collections and builds apps. Select some clips and tell it what they are. Image clips you select are sent along so it can look at them.",
    "- Apps are written in a small grammar: open **App editor** from the dock, or read **Reference**.",
    "",
    "Everything is kept on this board, for everyone it is shared with. Copy clips with ⌘C to carry them to another board.",
  ].join('\n');

  let fresh = false;
  async function seed() {
    if (PB.meta('seeded') || !PB.can('admin')) return;
    PB.mutate(m => {
      m.place({ kind: 'doc', title: 'Read me', md: WELCOME, x: 40, y: 40, w: 380, h: 330, tags: ['help'] });
      m.place({ kind: 'note', title: '', text: 'try: paste a link, a screenshot, a paragraph\nthen select them and ask the agent', x: 460, y: 40, w: 220, h: 100, tags: ['todo'] });
      m.place({ kind: 'link', title: 'Are.na', url: 'https://www.are.na/', desc: 'a reference for the pinboard idea', x: 460, y: 170, w: 260, h: 110, tags: ['inspo'] });
    });
    PB.meta('seeded', 1); PB.meta('title', 'Untitled board'); fresh = true;
  }

  function theme() {
    const root = document.documentElement; const cur = localStorage.getItem('pinboard.theme') || 'system';
    const apply = (t) => { root.dataset.theme = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t; };
    apply(cur);
    document.getElementById('themebtn').addEventListener('click', () => { const next = { system: 'light', light: 'dark', dark: 'system' }[localStorage.getItem('pinboard.theme') || 'system']; localStorage.setItem('pinboard.theme', next); apply(next); PB.toast('theme · ' + next); });
  }

  async function boot() {
    try { await PB.connect(); } catch (e) { console.error(e); }
    try { await PB.load(); } catch (e) { console.error(e); PB.toast('⚠ the board could not be loaded: ' + (e.message || e), 'long'); }
    PB.apps.seed();
    if (!PB.meta('seeded') && PB.can('admin') && !PB.S.apps.counter) { try { PB.apps.registerSource(PB.apps.TEMPLATE); } catch (e) { console.error(e); } }
    await seed();
    document.body.classList.toggle('readonly', !PB.can('interact'));
    PB.history.txs.length = 0; PB.history.idx = 0;
    PB.board.init();
    theme();
    const title = document.getElementById('boardtitle'); title.textContent = PB.meta('title') || 'My board'; document.title = (PB.meta('title') || 'Board') + ' · Pinboard'; title.contentEditable = PB.can('admin') ? 'true' : 'false'; title.addEventListener('blur', () => PB.meta('title', title.textContent.trim() || 'My board')); title.addEventListener('keydown', ev => { PB.keyStop(ev); if (ev.key === 'Enter') { ev.preventDefault(); title.blur(); } });
    document.getElementById('refbtn').addEventListener('click', () => PB.apps.open('reference'));
    document.getElementById('qlbtn').addEventListener('click', () => PB.board.quicklaunch());
    document.getElementById('logbtn').addEventListener('click', () => PB.apps.open('log'));
    // A new board: its name is the first thing to give it.
    if (fresh) setTimeout(() => { title.focus(); const r = document.createRange(); r.selectNodeContents(title); const s = getSelection(); s.removeAllRanges(); s.addRange(r); PB.toast('a new board: give it a name, then press Enter'); }, 300);
    PB.subscribe();
    PB.presence.init();
    PB.on('meta', (m) => { if (document.activeElement !== title) title.textContent = m.title || 'My board'; document.title = (m.title || 'Board') + ' · Pinboard'; });
    await PB.agent.init();
    PB.on('selection', (ids) => PB.board.cacheBlobs(ids));
    let saving = { inflight: 0, dirty: 0, failed: 0 };
    const status = () => {
      const s = document.getElementById('status');
      const busy = saving.inflight + saving.dirty;
      s.textContent = Object.keys(PB.S.clips).length + ' clips · ' + Object.keys(PB.S.collections).length + ' collections'
        + (PB.history.idx ? ' · ' + PB.history.idx + ' changes' : '')
        + (PB.rt.online ? (busy ? ' · saving…' : ' · saved') : ' · not saved (no slop runtime)')
        + (PB.can('interact') ? '' : ' · view only');
    };
    PB.on('mutation', status); PB.on('saving', (s) => { saving = s; status(); });
    status();
    if (!PB.rt.online) PB.toast('⚠ the slop runtime is not available here; nothing will be kept between visits', 'long');
    window.PB = PB;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.PB);
