/* boutique-css.js · the slop.boutique look for rendered views, adapted from catalog.css (Final design). */
window.BOUTIQUE_CSS = String.raw`
:root { --wall:#FFFFFF; --plinth:#F4F3F0; --table:#EEECE8; --line:#E7E5E1; --faint:#C6C3BD; --muted:#6F6C67; --ink:#2F2D2A; --warn:#B5603F; --ok:#2F6F4F; --sky:#CEE5FF; --blue:#2340D8; --accent:#2340D8;
  --sans:"ABC Areal","Helvetica Neue",Helvetica,Arial,system-ui,sans-serif; --mono:"ABC Areal Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace; --pad:48px; --label:342px; color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin:0; background:var(--wall); color:var(--ink); }
body { font:400 17px/22px var(--sans); -webkit-font-smoothing:antialiased; }
a { color:inherit; text-decoration:none; }
button, input, select, textarea { font:inherit; color:inherit; }
button { cursor:pointer; }
img { max-width:100%; display:block; }
::selection { background:var(--ink); color:var(--wall); }
:focus-visible { outline:1.5px solid var(--ink); outline-offset:3px; }
.visually-hidden { position:absolute !important; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.muted { color:var(--muted); } .small { font-size:14px; line-height:20px; }
.u, .tlink { color:var(--ink); text-decoration:underline; text-decoration-thickness:1px; text-decoration-color:var(--faint); text-underline-offset:4px; background:none; border:0; padding:0; }
.u:hover, .tlink:hover { text-decoration-color:var(--ink); }
.tlink.quiet { color:var(--muted); text-decoration-color:transparent; } .tlink.quiet:hover { color:var(--ink); }
.page { padding-left:max(var(--pad), env(safe-area-inset-left,0px)); padding-right:max(var(--pad), env(safe-area-inset-right,0px)); }
.sb-mount { min-height:100%; }
.sb-app { min-height:100vh; display:flex; flex-direction:column; }
.sb-main { flex:1; min-width:0; position:relative; }

/* frame */
.site-header { display:grid; grid-template-columns:var(--label) minmax(0,1fr) auto; align-items:center; gap:24px; padding-top:20px; padding-bottom:20px; font-size:15px; line-height:22px; }
.site-wordmark { font-weight:500; color:var(--ink); }
.site-statement { margin:0; color:var(--muted); }
.site-nav { display:flex; align-items:center; gap:20px; font-size:14px; line-height:20px; color:var(--muted); white-space:nowrap; }
.site-nav a:hover { color:var(--ink); }
.site-support { display:inline-flex; justify-content:center; align-items:center; padding:9px 16px; border-radius:3px; background:var(--sky); color:var(--ink) !important; font-weight:500; }
.support-mobile { display:none; }
.support-thanks { color:var(--muted); }
.sb-viewpick select { border:1px solid var(--line); border-radius:3px; background:var(--wall); padding:6px 8px; font-size:14px; color:var(--ink); max-width:180px; }
.site-footer { display:grid; grid-template-columns:var(--label) 1fr 1fr 1fr; gap:24px; margin-top:64px; padding:32px 0 48px; border-top:1px solid var(--line); font-size:15px; line-height:22px; }
.site-footer > div { display:flex; flex-direction:column; align-items:flex-start; gap:4px; min-width:0; }
.site-footer a, .site-footer p, .site-footer span { color:var(--muted); margin:0; }
.site-footer a:hover { color:var(--ink); }
.site-footer .site-wordmark { color:var(--ink); }
.site-footer.quiet { grid-template-columns:var(--label) 1fr; margin-top:48px; padding:20px 0 28px; }
.site-footer.quiet > div:last-child { flex-direction:row; gap:20px; }
.frame-overlay { min-height:100vh; }
.frame-overlay .sb-main { min-height:100vh; }
.sb-pill { position:fixed; top:calc(16px + env(safe-area-inset-top,0px)); right:max(16px, env(safe-area-inset-right,0px)); z-index:20; display:flex; align-items:center; gap:20px; padding:8px 8px 8px 16px; background:rgba(255,255,255,.94); border:1px solid var(--line); border-radius:3px; font-size:15px; }
.sb-pill .site-nav { gap:14px; }
.sb-pill .site-statement { display:none; }

/* layout */
.sb-col { display:flex; flex-direction:column; gap:16px; min-width:0; }
.sb-main > .sb-col { gap:0; }
.sb-row { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; flex-wrap:wrap; min-width:0; }
.sb-bar { display:flex; align-items:center; gap:24px; flex-wrap:wrap; padding:24px 0 16px; border-bottom:1px solid var(--line); font-size:15px; }
.sb-flow { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px 16px; padding:24px 0; }
.sb-split { display:grid; grid-template-columns:var(--left) minmax(0,1fr); gap:40px; padding-top:32px; align-items:start; }
.sb-split > .sb-col { min-width:0; }
.sb-switch { min-width:0; }
.sb-intro { padding:72px 0 40px; }
.sb-intro .sb-h1 { max-width:1000px; }
.sb-h1 { margin:0; font-weight:400; font-size:48px; line-height:52px; letter-spacing:-.025em; text-wrap:balance; overflow-wrap:anywhere; }
.sb-h2 { margin:0; font-weight:400; font-size:28px; line-height:32px; letter-spacing:-.02em; }
.sb-text { margin:12px 0 0; color:var(--muted); max-width:760px; }
.sb-note { margin:0; padding:12px 0; border-top:1px solid var(--ink); color:var(--muted); font-size:15px; }
.final-label { margin:0; font-size:15px; line-height:22px; color:var(--muted); }
.sb-divider { border:0; border-top:1px solid var(--line); margin:24px 0; width:100%; }
.only-phone { display:none !important; }
.prose p { margin:0 0 12px; } .prose h2, .prose h3, .prose h4 { margin:16px 0 8px; font-weight:500; font-size:17px; }
.prose ul { margin:0 0 12px; padding-left:20px; } .prose code { font:15px var(--mono); background:var(--plinth); padding:0 3px; }
.sb-err { margin:8px 0; padding:8px 12px; border-left:2px solid var(--warn); color:var(--warn); font:13px/18px var(--mono); background:#fbf3ef; white-space:pre-wrap; }

/* archive controls */
.archive-controls { display:grid; grid-template-columns:var(--label) minmax(0,1fr) auto; align-items:center; gap:24px; padding:56px 0 16px; border-bottom:1px solid var(--line); font-size:15px; line-height:22px; }
.archive-search { display:flex; flex-direction:row-reverse; align-items:center; width:280px; max-width:100%; height:36px; border:1px solid var(--line); border-radius:3px; }
.archive-search input { width:100%; min-width:0; padding:6px 8px 6px 0; border:0; background:transparent; font-size:15px; outline-offset:0; }
.archive-search input::placeholder { color:#a8a59e; }
.sb-search-icon { display:flex; padding:10px 12px; color:var(--muted); }
.archive-categories { display:flex; gap:22px; min-width:0; overflow:auto; scrollbar-width:thin; padding:3px 0; color:var(--muted); }
.archive-categories a { white-space:nowrap; } .archive-categories a:hover { color:var(--ink); }
.archive-categories a[aria-current] { color:var(--ink); font-weight:500; }
.archive-sort { display:flex; align-items:center; gap:8px; }
.archive-sort label { color:var(--muted); }
.archive-sort select { border:0; max-width:150px; background:transparent; padding:0; font-size:15px; cursor:pointer; }
.seg { display:flex; gap:20px; font-size:15px; }
.seg button { border:0; padding:0; background:none; color:var(--muted); text-decoration:underline; text-decoration-thickness:1px; text-decoration-color:transparent; text-underline-offset:4px; }
.seg button:hover { color:var(--ink); }
.seg button[aria-pressed="true"] { color:var(--ink); text-decoration-color:var(--ink); }
.sb-slider { display:grid; grid-template-columns:auto auto; justify-content:space-between; gap:2px 12px; font-size:14px; color:var(--muted); min-width:180px; }
.sb-slider input { grid-column:1 / -1; width:100%; accent-color:var(--ink); }
.sb-slider output { color:var(--ink); font-variant-numeric:tabular-nums; }
.sb-select { display:flex; align-items:center; gap:8px; font-size:14px; color:var(--muted); }
.sb-select select, .sb-select input { border:1px solid var(--line); border-radius:3px; padding:4px 6px; background:var(--wall); color:var(--ink); font-size:14px; }
.sb-toggle { display:flex; align-items:center; gap:8px; font-size:14px; color:var(--ink); } .sb-toggle input { accent-color:var(--ink); }
.sb-chip { border:0; background:none; padding:0; color:var(--ink); line-height:1.1; letter-spacing:-.01em; }
.sb-chip:hover, .sb-chip.on { text-decoration:underline; text-underline-offset:4px; }
.sb-settings { display:flex; flex-direction:column; gap:12px; min-width:220px; }
.sb-settings-toggle { align-self:flex-end; border:0; background:none; padding:0; color:var(--ink); text-decoration:underline; text-decoration-color:var(--faint); text-underline-offset:4px; font-size:14px; }
.sb-settings-group { border:0; border-top:1px solid var(--line); margin:0; padding:10px 0 0; display:flex; flex-direction:column; gap:10px; }
.sb-settings-group legend { padding:0 6px 0 0; font-size:13px; color:var(--muted); }

/* archive rows */
.archive-list { position:relative; }
.archive-row { display:flex; align-items:baseline; gap:24px; padding:18px 0; border-bottom:1px solid var(--line); color:var(--ink); }
.archive-row:hover .sb-title { color:var(--muted); }
.archive-row .cell { min-width:0; }
.c-number { width:calc(var(--label) - 24px); flex-shrink:0; }
.c-title { flex:1; }
.archive-row .sb-title { margin:0; font-size:24px; line-height:32px; letter-spacing:-.01em; font-weight:400; overflow-wrap:anywhere; }
.c-meta { width:408px; flex-shrink:0; }
.c-meta .sb-meta { display:flex; justify-content:space-between; gap:24px; }
.c-meta .sep { display:none; }
.c-tags { width:288px; flex-shrink:0; } .c-date { width:120px; flex-shrink:0; text-align:right; }
.c-thumb { display:none; }
.archive-number, .archive-tags, .archive-date, .sb-meta { font-size:15px; line-height:22px; color:var(--muted); }
.archive-thumb { position:relative; display:block; width:76px; height:54px; background:var(--table); border-radius:3px; overflow:hidden; }
.archive-thumb img { width:100%; height:100%; object-fit:cover; }
.archive-monogram { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:var(--ink); font-weight:500; font-size:15px; background:rgba(238,236,232,.82); }
.archive-preview { position:fixed; right:max(var(--pad),16px); bottom:24px; z-index:10; width:432px; max-width:42vw; aspect-ratio:8/5; border-radius:3px; overflow:hidden; pointer-events:none; background:var(--table); }
.archive-preview .sb-cover, .archive-preview .sb-cover img { height:100%; aspect-ratio:auto; border-radius:0; }
.archive-empty { padding:40px 0; color:var(--muted); }
.archive-empty p { margin:0 0 8px; }
.sb-more { margin-top:24px; }

/* buttons, badges */
.site-button { display:inline-flex; justify-content:center; align-items:center; border:0; border-radius:3px; padding:14px 20px; background:var(--table); font-size:15px; line-height:22px; font-weight:500; color:var(--ink); }
.site-button:hover { filter:brightness(.97); }
.sb-badge { display:inline-block; padding:1px 7px; border-radius:3px; background:var(--sky); color:var(--ink); font-size:13px; line-height:20px; font-weight:500; white-space:nowrap; }
.sb-kicker { margin:0; font-size:14px; line-height:20px; color:var(--muted); }
.sb-caption { margin:4px 0 0; font-size:15px; line-height:22px; color:var(--muted); }
.sb-description { margin:6px 0 0; font-size:15px; line-height:22px; color:var(--muted); max-width:720px; }
.sb-version { font:14px var(--mono); color:var(--muted); }
.sb-monogram { font-weight:500; font-size:20px; letter-spacing:-.04em; color:var(--ink); }
.sb-cover { display:block; width:100%; background:var(--table); border-radius:3px; overflow:hidden; aspect-ratio:8/5; }
.sb-cover img { width:100%; height:100%; object-fit:cover; }

/* cards, lists, grids */
.sb-grid { display:grid; grid-template-columns:repeat(var(--cols), minmax(0,1fr)); gap:40px 24px; padding:32px 0; }
.sb-card { display:flex; flex-direction:column; gap:10px; min-width:0; cursor:pointer; }
.sb-card .sb-title { margin:0; font-weight:400; font-size:20px; line-height:26px; letter-spacing:-.01em; overflow-wrap:anywhere; }
.sb-card .sb-title.t-h2 { font-size:24px; line-height:30px; }
.sb-card:hover .sb-title { color:var(--muted); }
.sb-list { list-style:none; margin:0; padding:0; border-top:1px solid var(--ink); }
.sb-list-row { display:flex; align-items:center; gap:14px; width:100%; padding:12px 0; border:0; border-bottom:1px solid var(--line); background:none; text-align:left; color:var(--muted); }
.sb-list-row .sb-title { margin:0; font-size:17px; line-height:22px; font-weight:400; color:inherit; }
.sb-list-row:hover, .sb-list-row.on { color:var(--ink); }
.sb-list-row.on .sb-title { font-weight:500; }
.sb-list-row .sb-monogram { width:44px; height:44px; display:grid; place-items:center; background:var(--plinth); border-radius:3px; font-size:15px; flex-shrink:0; }
.sb-list-row .sb-caption { margin:0 0 0 auto; }
.lines { display:flex; flex-direction:column; border-top:1px solid var(--ink); }
.line { display:flex; gap:24px; padding:18px 0 22px; border-bottom:1px solid var(--line); }
.line-label { width:calc(var(--label) - 24px); flex-shrink:0; color:var(--ink); }
.line-body { min-width:0; display:flex; flex-direction:column; gap:4px; }
.line-body .prose p { color:var(--muted); margin:0; }
.sb-strip { display:flex; gap:16px; overflow-x:auto; padding:8px 0 16px; scrollbar-width:thin; }
.sb-strip-card { flex:0 0 220px; display:flex; flex-direction:column; gap:8px; cursor:pointer; }
.sb-strip-card .archive-thumb { width:220px; height:138px; }
.sb-feed { display:flex; flex-direction:column; max-width:880px; padding:24px 0; }
.sb-feed-day { margin:40px 0 0; padding:0 0 10px; font-weight:400; font-size:15px; color:var(--muted); border-bottom:1px solid var(--ink); }
.sb-feed-item { display:flex; flex-direction:column; gap:8px; padding:24px 0 28px; border-bottom:1px solid var(--line); }
.sb-feed-item .sb-cover { max-width:560px; }
.sb-feed-item .sb-title { margin:0; font-size:28px; line-height:32px; letter-spacing:-.02em; font-weight:400; }
.sb-stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px,1fr)); border-top:1px solid var(--ink); }
.sb-stat { padding:16px 0 20px; border-bottom:1px solid var(--line); }
.sb-stat-n { font-weight:500; font-size:40px; line-height:42px; letter-spacing:-.03em; font-variant-numeric:tabular-nums; }
.sb-stat-l { color:var(--muted); font-size:15px; }

/* experiment page */
.sb-record { padding:72px 0 0; display:flex; flex-direction:column; gap:20px; }
.sb-record > .sb-meta, .sb-record .sb-meta { font-size:15px; }
.sb-record .sb-title.t-h1 { margin:0; min-width:0; font-size:96px; line-height:92px; font-weight:400; letter-spacing:-.045em; overflow-wrap:anywhere; }
.sb-record .sb-title.t-h2 { margin:0; font-size:48px; line-height:52px; font-weight:400; letter-spacing:-.025em; }
.experiment-description { max-width:1000px; margin:24px 0 0; font-size:28px; line-height:38px; }
.byline { margin:0; font-size:15px; color:var(--muted); }
.experiment-download { flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
.file-meta { font-size:14px; color:var(--muted); }
.experiment-runner { margin-top:24px; }
.runner-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0; font-size:15px; line-height:22px; }
.runner-toolbar > div { display:flex; align-items:center; gap:12px; }
.runner-state::before { content:""; display:inline-block; width:8px; height:8px; margin-right:10px; border-radius:50%; background:var(--faint); }
.is-live .runner-state::before { background:#EC9494; }
.runner-caption { color:var(--muted); }
.runner-tools { gap:20px !important; }
.runner-surface { width:100%; aspect-ratio:8/5; overflow:hidden; background:var(--table); border-radius:3px; }
.runner-surface > img, .runner-surface > canvas { display:block; width:100%; height:100%; object-fit:cover; }
.experiment-runner.size-inline .runner-surface { max-width:960px; }
.runner-start { display:flex; align-items:center; gap:20px; margin-top:16px; }
.sb-runner.peek { display:flex; align-items:center; gap:14px; font-size:14px; color:var(--muted); }
.experiment-editorial { margin-top:56px; }
.editorial-row { display:grid; grid-template-columns:var(--label) minmax(0,1fr); gap:0; padding:20px 0 24px; border-top:1px solid var(--line); }
.editorial-label { margin:0; font-size:15px; line-height:22px; font-weight:400; color:var(--muted); }
.editorial-body { max-width:760px; }
.editorial-body p { margin:0 0 12px; }
.experiment-gallery { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:24px; margin-top:48px; }
.experiment-gallery figure { margin:0; } .experiment-gallery img { border-radius:3px; width:100%; aspect-ratio:8/5; object-fit:cover; }
.attachments { list-style:none; margin:0 0 8px; padding:0; display:flex; flex-direction:column; gap:6px; }
.support-callout { display:grid; grid-template-columns:calc(var(--label) - 40px) minmax(0,1fr); gap:24px; margin-top:120px; padding:64px 40px 72px; background:var(--sky); border-radius:3px; }
.callout-label { margin:0; font-size:15px; line-height:22px; }
.support-callout h2 { margin:0 0 24px; font-size:64px; line-height:64px; letter-spacing:-.035em; font-weight:400; }
.support-callout div > p { max-width:760px; margin:0 0 36px; font-size:20px; line-height:30px; }
.callout-button { background:var(--wall); }
.callout-contact { margin-left:28px; font-size:15px; }
.sb-support-quiet { margin:40px 0 0; font-size:15px; color:var(--muted); }

/* canvas, galaxy, board, deck, overlays */
.sb-canvas { padding:24px 0; }
.sb-canvas canvas { display:block; width:100%; }
.sb-galaxy { position:relative; }
.sb-galaxy-canvas { display:block; width:100%; height:72vh; min-height:420px; }
.frame-overlay .sb-galaxy-canvas { height:100vh; }
.sb-overlay { position:absolute; z-index:5; display:flex; flex-direction:column; gap:12px; padding:14px 16px; max-width:min(360px, calc(100% - 32px)); background:rgba(255,255,255,.94); border:1px solid var(--line); border-radius:3px; font-size:15px; }
.sb-overlay.top-left { top:16px; left:16px; } .sb-overlay.top-right { top:72px; right:16px; } .sb-overlay.bottom-left { bottom:16px; left:16px; } .sb-overlay.bottom-right { bottom:16px; right:16px; }
.sb-overlay .archive-search { width:100%; }
.sb-overlay .sb-text { margin:0; }
.sb-sheet { position:fixed; top:0; right:0; bottom:0; z-index:30; width:min(520px, 100%); overflow:auto; background:var(--wall); border-left:1px solid var(--line); padding:20px 28px 40px; }
.sb-sheet-close { position:sticky; top:0; float:right; border:0; background:var(--wall); padding:4px 0; color:var(--muted); text-decoration:underline; text-underline-offset:4px; font-size:14px; }
.sb-sheet .sb-record { padding-top:24px; }
.sb-sheet .sb-record .sb-title.t-h2 { font-size:40px; line-height:42px; }
.sb-sheet .experiment-description { font-size:20px; line-height:28px; }
.sb-board { position:relative; height:76vh; min-height:480px; margin-top:24px; overflow:hidden; background:var(--plinth); border-radius:3px; touch-action:none; cursor:grab; }
.sb-board-plane { position:absolute; inset:0; }
.sb-board-card { position:absolute; display:flex; flex-direction:column; gap:6px; padding:8px; background:var(--wall); border:1px solid var(--line); border-radius:3px; cursor:pointer; user-select:none; }
.sb-board.can-drag .sb-board-card { cursor:move; }
.sb-board-card .sb-title { margin:0; font-size:15px; line-height:20px; font-weight:400; }
.sb-board-hint { position:absolute; left:16px; bottom:12px; margin:0; font-size:13px; color:var(--muted); pointer-events:none; }
.sb-deck { padding:32px 0; display:flex; flex-direction:column; gap:20px; }
.sb-deck-stage { touch-action:pan-y; }
.sb-deck-card { display:flex; flex-direction:column; gap:14px; max-width:1000px; }
.sb-deck-card .sb-title { margin:0; font-size:56px; line-height:58px; letter-spacing:-.035em; font-weight:400; }
.sb-deck-nav { display:flex; align-items:center; gap:24px; font-size:15px; color:var(--muted); flex-wrap:wrap; }
.sb-deck-pos { font-variant-numeric:tabular-nums; }
.sb-deck-dots { display:flex; gap:6px; } .sb-deck-dots i { width:7px; height:7px; border-radius:50%; background:var(--line); } .sb-deck-dots i.on { background:var(--ink); }
.sb-island { min-height:40px; }
@keyframes sb-marquee { from { transform:translateX(0); } to { transform:translateX(-50%); } }
.sb-main > .sb-col > .archive-list:first-child, .sb-main > .sb-col > .sb-grid:first-child, .sb-main > .sb-col > .sb-deck:first-child, .sb-main > .sb-col > .sb-feed:first-child, .sb-main > .sb-col > .sb-split:first-child { margin-top:24px; }
.sb-main > .sb-col > .archive-list:first-child { border-top:1px solid var(--ink); }
.archive-row .cell p { margin:0; }
.archive-row.static { cursor:default; }
.archive-row .site-button { padding:8px 12px; font-size:14px; line-height:20px; white-space:nowrap; }
.archive-row.static:hover .sb-title { color:var(--ink); }
.c-text { width:120px; flex-shrink:0; font:14px var(--mono); color:var(--muted); }
.c-caption, .c-badge, .c-button, .c-version { flex-shrink:0; }
.sb-row > .x-orbit { flex:0 0 auto; } .sb-row > .archive-list { flex:1; min-width:280px; }
.sb-main > .sb-col > .sb-row { align-items:flex-start; padding-top:32px; }
.sb-record .sb-row { align-items:flex-end; }
.sb-main > .sb-col > .final-label { margin-top:48px; padding-bottom:8px; border-bottom:1px solid var(--ink); }

@media (max-width:1200px) and (min-width:901px) {
  :root { --label:240px; }
  .c-meta { width:260px; } .c-tags { width:180px; } .c-date { width:80px; }
}
@media (max-width:900px) {
  :root { --pad:20px; }
  .only-phone { display:revert !important; } .only-desktop { display:none !important; }
  .site-header { grid-template-columns:minmax(0,1fr) auto; gap:12px; height:60px; padding-top:0; padding-bottom:0; position:relative; border-bottom:1px solid var(--line); }
  .site-statement, .support-desktop { display:none; } .support-mobile { display:inline; }
  .site-header.quiet > span { display:none; }
  .site-nav { gap:14px; } .site-support { padding:8px 14px; }
  .sb-viewpick select { max-width:110px; }
  .sb-intro { padding:32px 0 24px; } .sb-h1 { font-size:30px; line-height:34px; }
  .archive-controls { grid-template-columns:minmax(0,1fr) auto; gap:14px 12px; padding:16px 0 12px; }
  .archive-search { width:100%; height:40px; }
  .archive-categories { grid-row:2; grid-column:1 / -1; gap:6px; font-size:14px; padding:0; scrollbar-width:none; }
  .archive-categories a { padding:6px 12px 6px 0; }
  .archive-sort label { display:none; } .archive-sort select { max-width:105px; font-size:14px; }
  .archive-row { display:grid; grid-template-columns:36px minmax(0,1fr) auto; column-gap:12px; row-gap:2px; align-items:center; padding:12px 0; min-height:78px; }
  .archive-row .cell { grid-column:2; }
  .archive-row .c-number { grid-column:1; grid-row:1 / span 2; width:auto; font-size:13px; }
  .archive-row .c-thumb { display:block; grid-column:3; grid-row:1 / span 3; }
  .archive-row .sb-title { font-size:20px; line-height:24px; }
  .c-meta { width:auto; } .c-meta .sb-meta { display:block; font-size:13px; line-height:20px; } .c-meta .sep { display:inline; }
  .c-tags, .c-date { width:auto; text-align:left; font-size:13px; }
  .archive-row .archive-tags, .archive-row .archive-date, .archive-row .archive-number { font-size:13px; line-height:20px; }
  .archive-preview { display:none !important; }
  .sb-grid { grid-template-columns:repeat(2, minmax(0,1fr)); gap:28px 16px; }
  .sb-split { grid-template-columns:1fr; gap:24px; }
  .line { flex-direction:column; gap:6px; } .line-label { width:auto; }
  .editorial-row { grid-template-columns:1fr; gap:8px; }
  .sb-record { padding-top:32px; } .sb-record .sb-title.t-h1 { font-size:48px; line-height:48px; } .experiment-description { font-size:20px; line-height:28px; }
  .experiment-gallery { grid-template-columns:1fr; }
  .support-callout { grid-template-columns:1fr; gap:16px; margin-top:64px; padding:32px 20px 28px; }
  .support-callout h2 { font-size:34px; line-height:36px; margin:0 0 20px; }
  .support-callout div > p { font-size:17px; line-height:24px; margin:0 0 24px; }
  .callout-button { display:flex; width:100%; } .callout-contact { display:block; margin:14px 0 0; text-align:center; font-size:14px; }
  .site-footer { grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:28px 20px; margin-top:48px; padding:24px 0 32px; font-size:14px; line-height:20px; }
  .site-footer .footer-brand, .site-footer .footer-type { grid-column:1 / -1; } .footer-type > span { display:none; }
  .sb-deck-card .sb-title { font-size:34px; line-height:36px; }
  .sb-pill { left:max(12px, env(safe-area-inset-left,0px)); right:max(12px, env(safe-area-inset-right,0px)); justify-content:space-between; }
  .sb-overlay.top-left { top:72px; } .sb-overlay { max-width:calc(100% - 32px); }
  .sb-overlay.bottom-right { left:16px; }
}
@media (max-width:520px) { .sb-grid { grid-template-columns:1fr; } .sb-viewpick { display:none; } }

/* ---- new API: themes, forms, prose, search, free, draw, terminal, scene ---- */
body { font-stretch:var(--stretch, normal); }
.site-button, .site-support { border-radius:var(--radius, 3px); }
.sb-divider.fill { height:2px; border:0; background:var(--line); margin:0 0 18px; position:relative; overflow:hidden; }
.sb-divider.fill i { display:block; height:100%; background:var(--ink); transition:width .08s linear; }
.archive-row.on { background:var(--plinth); }
.archive-row.on .c-title::before { content:'♪ '; }
.sb-count { color:var(--muted); font-size:.85em; }
.sb-chips { display:flex; flex-wrap:wrap; gap:8px 14px; margin-top:8px; font-size:14px; }
mark { background:var(--sky); color:inherit; padding:0 1px; border-radius:2px; }
.sb-snippet { margin:4px 0 0; color:var(--muted); font-size:15px; line-height:21px; }
.sb-cover { transition:transform .25s ease; }
.sb-cover.size-full img { width:100%; max-height:62vh; object-fit:cover; }
.sb-prose { max-width:42rem; }
.sb-prose h1, .sb-prose .sb-h1 { font-size:44px; line-height:46px; letter-spacing:-.02em; font-weight:500; margin:8px 0 18px; }
.sb-prose blockquote { margin:0 0 16px; padding-left:16px; border-left:2px solid var(--line); color:var(--muted); }
.sb-v { font-variant-numeric:tabular-nums; background:var(--plinth); padding:0 4px; border-radius:3px; }
.sb-pre { background:var(--plinth); padding:12px 14px; overflow:auto; font:13px/19px var(--mono); }
.sb-form { display:grid; gap:12px; max-width:34rem; margin:12px 0 28px; }
.sb-form-fields { display:grid; gap:10px; }
.sb-form-field { display:grid; grid-template-columns:5rem 1fr; align-items:center; gap:12px; font-size:14px; color:var(--muted); }
.sb-form input[type=text], .sb-form input[type=number] { font:inherit; color:var(--ink); background:var(--wall); border:1px solid var(--line); border-radius:3px; padding:8px 10px; }
.sb-form .site-button { justify-self:start; }
.sb-embed { margin:20px 0; }
.sb-embed.own-wall { background:var(--wall); color:var(--ink); padding:20px; }
.sb-play { border:1px solid var(--line); background:var(--wall); color:var(--ink); border-radius:999px; padding:6px 12px; font:inherit; font-size:13px; cursor:pointer; }
.sb-play.on { background:var(--ink); color:var(--wall); }
.sb-fallback { margin:0; }
/* free */
.fx-box { position:relative; display:flex; flex-direction:column; }
.fx-stack { display:flex; }
.fx-layer { position:absolute; }
.fx-type { display:block; overflow-wrap:break-word; }
.fx-link { color:inherit; text-decoration:none; display:block; }
.fx-link:hover .fx-type { text-decoration:underline; text-decoration-thickness:max(1px, .04em); text-underline-offset:.12em; }
.fx-each { display:flex; flex-direction:column; }
.fx-flow { margin:0; }
.fx-flow .fx-flow-item, .fx-flow .fx-link, .fx-flow .fx-type { display:inline; }
.fx-sep { color:var(--muted); }
.fx-image { display:block; max-width:100%; }
.fx-each.empty:empty { display:none; }
/* draw */
.dr { position:relative; margin:8px 0 20px; }
.dr-svg { display:block; overflow:visible; max-width:100%; }
.dr-svg a.dr-link, .dr-hot { cursor:pointer; }
.dr-svg a.dr-link:hover circle, .dr-svg a.dr-link:hover rect { stroke:var(--ink); stroke-width:1.5; }
.dr-svg text { font-family:inherit; }
.dr-items { position:absolute; inset:0; pointer-events:none; }
.dr-item { position:absolute; pointer-events:auto; width:max-content; max-width:900px; }
.dr-item.can-drag { cursor:grab; touch-action:none; }
.dr-item.can-drag:active { cursor:grabbing; }
.dr-item .sb-title { font-size:15px; line-height:19px; margin:6px 0 0; }
.dr-pan { position:relative; overflow:hidden; margin:0; background:var(--plinth); touch-action:none; cursor:grab; }
.dr-pan.panning { cursor:grabbing; }
.dr-world { position:absolute; left:0; top:0; transform-origin:0 0; background:var(--wall); }
.dr-hint { position:absolute; right:16px; bottom:12px; margin:0; font-size:13px; color:var(--muted); pointer-events:none; }
.dr-canvas { display:block; width:100%; }
.dr-tip { position:absolute; pointer-events:none; background:var(--ink); color:var(--wall); font-size:12px; line-height:16px; padding:4px 8px; border-radius:3px; max-width:280px; z-index:5; }
.frame-overlay .dr, .frame-overlay .sc { margin:0; }
/* terminal */
.tm { background:var(--wall); color:var(--ink); font:14px/20px var(--mono); padding:16px 18px 18px; min-height:60vh; cursor:text; border:1px solid var(--line); }
.tm-out { margin:0; white-space:pre-wrap; font:inherit; }
.tm-line { display:flex; align-items:baseline; margin:0; }
.tm-prompt { white-space:pre; }
.tm-in { flex:1; min-width:0; background:transparent; border:0; outline:none; color:inherit; font:inherit; padding:0; caret-color:var(--ink); }
/* scene */
.sc { position:relative; }
.sc-canvas { display:block; width:100%; outline:none; touch-action:none; }
@media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
`;
