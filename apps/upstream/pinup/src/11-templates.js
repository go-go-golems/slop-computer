// ---------- example file: a small running-club app ----------
// Written as HTML on purpose: it goes through the same importer Claude uses, so the example shows the conventions.
const EX_TOKENS = {
  colors: {
    paper: { name: 'Paper', light: '#F5F3EE', dark: '#111110' },
    surface: { name: 'Surface', light: '#FFFFFF', dark: '#1C1C1A' },
    ink: { name: 'Ink', light: '#151514', dark: '#F2F0EA' },
    muted: { name: 'Muted', light: '#6C6A64', dark: '#A3A09A' },
    line: { name: 'Line', light: '#E2DED5', dark: '#2E2D2A' },
    accent: { name: 'Signal', light: '#FF5A1F', dark: '#FF6B36' },
    'accent-ink': { name: 'On signal', light: '#FFFFFF', dark: '#1A0B05' },
  },
  type: {
    display: { name: 'Display', font: 'Space Grotesk', size: 44, weight: 700, lh: 1.02, ls: -1.2 },
    title: { name: 'Title', font: 'Space Grotesk', size: 22, weight: 700, lh: 1.2, ls: -0.3 },
    body: { name: 'Body', font: 'Inter', size: 16, weight: 400, lh: 1.45, ls: 0 },
    label: { name: 'Label', font: 'Inter', size: 15, weight: 600, lh: 1.2, ls: 0 },
    caption: { name: 'Caption', font: 'Inter', size: 13, weight: 500, lh: 1.3, ls: 0 },
  },
};
const T_DISPLAY = "font-family:'Space Grotesk';font-size:44px;font-weight:700;line-height:1.02;letter-spacing:-1.2px";
const T_TITLE = "font-family:'Space Grotesk';font-size:22px;font-weight:700;line-height:1.2;letter-spacing:-0.3px";
const T_BODY = 'font-family:Inter;font-size:16px;font-weight:400;line-height:1.45';
const T_LABEL = 'font-family:Inter;font-size:15px;font-weight:600;line-height:1.2';
const T_CAP = 'font-family:Inter;font-size:13px;font-weight:500;line-height:1.3';
const EX_COMPONENTS = `
<div data-component="Button/Primary" style="display:flex;align-items:center;justify-content:center;gap:8px;width:342px;height:54px;padding:0 24px;border-radius:999px;background:var(--tk-accent)">
  <span data-name="Label" style="${T_LABEL};color:var(--tk-accent-ink)">Join run</span>
  <i data-name="Icon" data-icon="arrow-right" style="width:18px;height:18px;color:var(--tk-accent-ink)"></i>
</div>
<div data-component="Button/Secondary" style="display:flex;align-items:center;justify-content:center;gap:8px;width:342px;height:54px;padding:0 24px;border-radius:999px;border:1.5px solid var(--tk-line);background:var(--tk-surface)">
  <span data-name="Label" style="${T_LABEL};color:var(--tk-ink)">Not now</span>
</div>
<div data-component="Run card" style="display:flex;align-items:center;gap:14px;width:342px;padding:14px;border-radius:18px;background:var(--tk-surface);border:1px solid var(--tk-line)">
  <div data-name="Date" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:56px;height:60px;border-radius:12px;background:var(--tk-paper)">
    <span data-name="Day" style="${T_CAP};color:var(--tk-accent);letter-spacing:0.6px">SAT</span>
    <span data-name="Num" style="font-family:'Space Grotesk';font-size:22px;font-weight:700;line-height:1;color:var(--tk-ink)">14</span>
  </div>
  <div data-name="Info" style="display:flex;flex-direction:column;gap:4px;flex:1">
    <span data-name="Title" style="${T_LABEL};font-size:16px;color:var(--tk-ink)">Saturday Long Run</span>
    <span data-name="Meta" style="${T_CAP};color:var(--tk-muted)">7:00 · Riverside Park</span>
    <div data-name="Tags" style="display:flex;gap:6px;padding-top:4px">
      <span data-name="Distance" style="${T_CAP};font-size:12px;padding:3px 8px;border-radius:999px;background:var(--tk-paper);color:var(--tk-ink)">18 km</span>
      <span data-name="Pace" style="${T_CAP};font-size:12px;padding:3px 8px;border-radius:999px;background:var(--tk-paper);color:var(--tk-ink)">Easy · 6:00/km</span>
    </div>
  </div>
  <i data-name="Chevron" data-icon="chevron-right" style="width:20px;height:20px;color:var(--tk-muted)"></i>
</div>
<div data-component="Tab bar" style="display:flex;justify-content:space-between;align-items:center;width:390px;height:84px;padding:10px 32px 26px;background:var(--tk-surface);border-top:1px solid var(--tk-line)">
  <div data-name="Home" style="display:flex;flex-direction:column;align-items:center;gap:4px"><i data-name="Icon" data-icon="house" style="width:22px;height:22px;color:var(--tk-ink)"></i><span data-name="Label" style="${T_CAP};font-size:11px;color:var(--tk-ink)">Home</span></div>
  <div data-name="Runs" style="display:flex;flex-direction:column;align-items:center;gap:4px"><i data-name="Icon" data-icon="calendar" style="width:22px;height:22px;color:var(--tk-muted)"></i><span data-name="Label" style="${T_CAP};font-size:11px;color:var(--tk-muted)">Runs</span></div>
  <div data-name="Club" style="display:flex;flex-direction:column;align-items:center;gap:4px"><i data-name="Icon" data-icon="users" style="width:22px;height:22px;color:var(--tk-muted)"></i><span data-name="Label" style="${T_CAP};font-size:11px;color:var(--tk-muted)">Club</span></div>
  <div data-name="Me" style="display:flex;flex-direction:column;align-items:center;gap:4px"><i data-name="Icon" data-icon="circle-user" style="width:22px;height:22px;color:var(--tk-muted)"></i><span data-name="Label" style="${T_CAP};font-size:11px;color:var(--tk-muted)">Me</span></div>
</div>`;
const EX_WELCOME = `
<div data-name="Welcome" data-flow="Join a run" style="display:flex;flex-direction:column;justify-content:space-between;width:390px;height:844px;padding:72px 24px 44px;background:var(--tk-paper)">
  <div data-name="Brand" style="display:flex;align-items:center;gap:8px">
    <i data-name="Mark" data-icon="footprints" style="width:26px;height:26px;color:var(--tk-accent)"></i>
    <span data-name="Wordmark" style="font-family:'Space Grotesk';font-size:19px;font-weight:700;letter-spacing:-0.3px;color:var(--tk-ink)">Pace Club</span>
  </div>
  <div data-name="Hero" style="display:flex;flex-direction:column;gap:18px">
    <div data-name="Route art" style="width:342px;height:200px;border-radius:24px;background:linear-gradient(135deg, #FF5A1F 0%, #FF9A3D 55%, #FFD27A 100%)"></div>
    <h1 data-name="Headline" style="${T_DISPLAY};margin:0;color:var(--tk-ink)">Run together.<br>Every week.</h1>
    <p data-name="Intro" style="${T_BODY};margin:0;color:var(--tk-muted)">Group runs near you, from easy 5Ks to long Sunday miles. Pick one, tap in, show up.</p>
  </div>
  <div data-name="Actions" style="display:flex;flex-direction:column;gap:12px">
    <div data-instance="Button/Primary" data-link="Home" data-transition="push-left" style="height:54px"><span data-name="Label">Find a run</span></div>
    <div data-instance="Button/Secondary" style="height:54px"><span data-name="Label">I already have an account</span></div>
  </div>
</div>`;
const EX_HOME = `
<div data-name="Home" style="display:flex;flex-direction:column;width:390px;height:844px;background:var(--tk-paper)">
  <div data-name="Content" style="display:flex;flex-direction:column;gap:24px;padding:64px 24px 24px;flex:1">
    <div data-name="Header" style="display:flex;justify-content:space-between;align-items:center">
      <div data-name="Greeting" style="display:flex;flex-direction:column;gap:2px">
        <span data-name="Hello" style="${T_CAP};color:var(--tk-muted)">Good morning, Maya</span>
        <span data-name="Title" style="${T_TITLE};color:var(--tk-ink)">This week</span>
      </div>
      <div data-name="Avatar" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:999px;background:var(--tk-ink)"><span data-name="Initials" style="${T_CAP};color:var(--tk-paper)">MK</span></div>
    </div>
    <div data-name="Stats" style="display:flex;gap:10px">
      <div data-name="Runs" style="display:flex;flex-direction:column;gap:4px;flex:1;padding:14px;border-radius:16px;background:var(--tk-surface);border:1px solid var(--tk-line)"><span data-name="Value" style="font-family:'Space Grotesk';font-size:26px;font-weight:700;line-height:1.1;color:var(--tk-ink)">3</span><span data-name="Label" style="${T_CAP};color:var(--tk-muted)">runs</span></div>
      <div data-name="Distance" style="display:flex;flex-direction:column;gap:4px;flex:1;padding:14px;border-radius:16px;background:var(--tk-surface);border:1px solid var(--tk-line)"><span data-name="Value" style="font-family:'Space Grotesk';font-size:26px;font-weight:700;line-height:1.1;color:var(--tk-ink)">18.4</span><span data-name="Label" style="${T_CAP};color:var(--tk-muted)">km</span></div>
      <div data-name="Pace" style="display:flex;flex-direction:column;gap:4px;flex:1;padding:14px;border-radius:16px;background:var(--tk-accent)"><span data-name="Value" style="font-family:'Space Grotesk';font-size:26px;font-weight:700;line-height:1.1;color:var(--tk-accent-ink)">5:42</span><span data-name="Label" style="${T_CAP};color:var(--tk-accent-ink)">avg /km</span></div>
    </div>
    <div data-name="Upcoming" style="display:flex;flex-direction:column;gap:12px">
      <div data-name="Section header" style="display:flex;justify-content:space-between;align-items:baseline">
        <span data-name="Title" style="${T_LABEL};font-size:17px;color:var(--tk-ink)">Upcoming near you</span>
        <span data-name="See all" style="${T_CAP};color:var(--tk-accent)">See all</span>
      </div>
      <div data-instance="Run card" data-link="Run detail" data-transition="slide-left"><span data-name="Title">Saturday Long Run</span></div>
      <div data-instance="Run card"><span data-name="Day">SUN</span><span data-name="Num">15</span><span data-name="Title">Sunrise 5K</span><span data-name="Meta">6:30 · Harbour Steps</span><span data-name="Distance">5 km</span><span data-name="Pace">All paces</span></div>
      <div data-instance="Run card"><span data-name="Day">TUE</span><span data-name="Num">17</span><span data-name="Title">Track Tuesday</span><span data-name="Meta">18:30 · City Track</span><span data-name="Distance">8 × 400 m</span><span data-name="Pace">Intervals</span></div>
    </div>
  </div>
  <div data-instance="Tab bar" style="height:84px"></div>
</div>`;
const EX_DETAIL = `
<div data-name="Run detail" style="display:flex;flex-direction:column;width:390px;height:844px;background:var(--tk-paper)">
  <div data-name="Map" style="position:relative;display:flex;flex-direction:column;justify-content:space-between;height:300px;padding:56px 16px 16px;background:linear-gradient(160deg, #2B2A27 0%, #3C3A35 100%)">
    <div data-name="Top bar" style="display:flex;justify-content:space-between">
      <div data-name="Back" data-link="back" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:999px;background:rgba(255,255,255,0.92)"><i data-name="Icon" data-icon="arrow-left" style="width:20px;height:20px;color:#151514"></i></div>
      <div data-name="Share" style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:999px;background:rgba(255,255,255,0.92)"><i data-name="Icon" data-icon="share" style="width:18px;height:18px;color:#151514"></i></div>
    </div>
    <div data-name="Route badge" style="display:flex;align-items:center;gap:6px;align-self:flex-start;padding:6px 10px;border-radius:999px;background:var(--tk-accent)"><i data-name="Icon" data-icon="route" style="width:16px;height:16px;color:#FFFFFF"></i><span data-name="Label" style="${T_CAP};color:#FFFFFF">Riverside loop · 18 km</span></div>
  </div>
  <div data-name="Body" style="display:flex;flex-direction:column;gap:20px;padding:24px 24px 0;flex:1">
    <div data-name="Heading" style="display:flex;flex-direction:column;gap:6px">
      <span data-name="Kicker" style="${T_CAP};color:var(--tk-accent);letter-spacing:0.6px">SATURDAY 14 JUNE</span>
      <h2 data-name="Title" style="font-family:'Space Grotesk';font-size:30px;font-weight:700;line-height:1.1;letter-spacing:-0.6px;margin:0;color:var(--tk-ink)">Saturday Long Run</h2>
    </div>
    <div data-name="Facts" style="display:flex;flex-direction:column;gap:12px">
      <div data-name="When" style="display:flex;align-items:center;gap:10px"><i data-name="Icon" data-icon="clock" style="width:18px;height:18px;color:var(--tk-muted)"></i><span data-name="Text" style="${T_BODY};color:var(--tk-ink)">7:00 start · back by 9:00</span></div>
      <div data-name="Where" style="display:flex;align-items:center;gap:10px"><i data-name="Icon" data-icon="map-pin" style="width:18px;height:18px;color:var(--tk-muted)"></i><span data-name="Text" style="${T_BODY};color:var(--tk-ink)">Riverside Park, north gate</span></div>
      <div data-name="Pace" style="display:flex;align-items:center;gap:10px"><i data-name="Icon" data-icon="gauge" style="width:18px;height:18px;color:var(--tk-muted)"></i><span data-name="Text" style="${T_BODY};color:var(--tk-ink)">Easy, 5:45–6:15 /km, no-drop</span></div>
    </div>
    <div data-name="Going" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;background:var(--tk-surface);border:1px solid var(--tk-line)">
      <div data-name="Faces" style="display:flex">
        <div data-name="A" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;background:#2F6F4F;border:2px solid var(--tk-surface)"><span style="${T_CAP};font-size:11px;color:#FFFFFF">JO</span></div>
        <div data-name="B" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;background:#3B5BDB;border:2px solid var(--tk-surface);margin-left:-8px"><span style="${T_CAP};font-size:11px;color:#FFFFFF">AL</span></div>
        <div data-name="C" style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;background:#B5476B;border:2px solid var(--tk-surface);margin-left:-8px"><span style="${T_CAP};font-size:11px;color:#FFFFFF">RS</span></div>
      </div>
      <span data-name="Count" style="${T_CAP};color:var(--tk-ink);flex:1">24 going · 6 spots left</span>
    </div>
    <p data-name="About" style="${T_BODY};margin:0;color:var(--tk-muted)">Two loops of the river path with a coffee stop at the boathouse. Pacers hold the back so nobody runs alone.</p>
  </div>
  <div data-name="Footer" style="display:flex;flex-direction:column;padding:16px 24px 36px">
    <div data-instance="Button/Primary" style="height:54px"><span data-name="Label">I'm in</span></div>
  </div>
</div>`;
async function loadExample() {
  if (!S.canEdit) return;
  toast('Building the example…', 4000);
  const appPage = S.pageId;
  const compPage = 'p' + uid(6);
  begin('Example app');
  try {
    setFile({ name: S.file.name === 'Untitled' ? 'Pace Club' : S.file.name, pages: [{ id: appPage, name: 'App' }, ...S.file.pages.filter(p => p.id !== appPage), { id: compPage, name: 'Components' }], tokens: clone(EX_TOKENS) });
    updateTokenStyle();
    const c = await importHTML(EX_COMPONENTS, { page: compPage, parent: null, x: 0, y: 0, label: 'Example components', width: 390 });
    // lay the components out in a column
    if (c) { let y = 0; const ch = c.ids.map(id => { const n = get(id); const nn = Object.assign({}, n, { x: 0, y }); y += Math.round(n.h) + 48; return { id, after: nn }; }); commit(ch); }
    const w = await importHTML(EX_WELCOME, { page: appPage, x: 0, y: 0, width: 390 });
    const hm = await importHTML(EX_HOME, { page: appPage, x: 470, y: 0, width: 390 });
    const dt = await importHTML(EX_DETAIL, { page: appPage, x: 940, y: 0, width: 390 });
    // links that name screens imported later
    const home = hm && get(hm.ids[0]), detail = dt && get(dt.ids[0]);
    const fix = [];
    const welcome = w && get(w.ids[0]);
    if (welcome && home) { const btn = descendants(welcome.id).find(n => n.type === 'instance' && n.name === 'Button/Primary'); if (btn) fix.push({ id: btn.id, after: Object.assign({}, btn, { link: { to: home.id, on: 'click', tr: 'push-left', dur: 300 } }) }); }
    if (home && detail) { const card = descendants(home.id).find(n => n.type === 'instance' && n.name === 'Run card'); if (card) fix.push({ id: card.id, after: Object.assign({}, card, { link: { to: detail.id, on: 'click', tr: 'slide-left', dur: 300 } }) }); }
    if (fix.length) commit(fix);
    bindTextStyles(appPage); bindTextStyles(compPage);
  } finally { end(); }
  S.pageId = appPage; S.sel = [];
  markAllDirty(); renderNow();
  requestAnimationFrame(() => requestAnimationFrame(() => { zoomFitAll(); toast('Example ready — press Present to click through it'); }));
}
// attach text styles to text layers that match them exactly
function bindTextStyles(pageId) {
  const T = S.file.tokens.type || {}; const ch = [];
  for (const n of S.nodes.values()) {
    if (n.type !== 'text' || n.tstyle || (pageId && n.page !== pageId)) continue;
    const id = Object.keys(T).find(k => { const t = T[k]; return t.font === n.font && Math.abs(t.size - n.size) < 0.01 && +t.weight === +n.weight && Math.abs((t.lh || 0) - (n.lh || 0)) < 0.02; });
    if (id) ch.push({ id: n.id, after: Object.assign({}, n, { tstyle: id }) });
  }
  if (ch.length) commit(ch);
}
