// main.js — the page's entry: the views the dock can show, the panel calls
// added to the host API (they need the page), then the shell boots.
//
// The only module allowed to import from every layer; nothing imports it.
import { $, clear, h } from './lib/dom.js';
import { API } from './agent/api/index.js';
import { App } from './ui/app.js';
import { CANVAS } from './ui/canvas.js';
import { CODE, DOCS } from './ui/code.js';
import { CONSOLE, EVAL } from './ui/console.js';
import { DATA } from './ui/data.js';
import { INSPECTOR, LAYERS } from './ui/inspect.js';
import { NOTES } from './agent/guide.js';
import { PANELS, PANEL_API, PANEL_NOTE, initSources } from './ui/panels.js';
import { REVIEW } from './ui/review.js';
import { SCENARIOS } from './ui/scenarios.js';
import { THREADS } from './ui/threads.js';
import { TIMELINE } from './ui/history.js';
import { registerViews } from './ui/dock.js';

// view ids are what saved layouts (ui/dock.js LAYOUTS, the person's prefs) name
registerViews({
  agent: THREADS, evalrepl: EVAL, canvas: CANVAS, timeline: TIMELINE, console: CONSOLE, data: DATA, scenarios: SCENARIOS,
  code: CODE, docs: DOCS, review: REVIEW, inspector: INSPECTOR, layers: LAYERS, panels: PANELS,
})
API.add(PANEL_API)
NOTES.ui = PANEL_NOTE
initSources()

App.boot().catch(e => {
  console.error(e)
  clear($('#app')).appendChild(h('div.boot', h('div', h('b', 'The bench could not start'), h('pre.note', String((e && e.stack) || e)))))
})
