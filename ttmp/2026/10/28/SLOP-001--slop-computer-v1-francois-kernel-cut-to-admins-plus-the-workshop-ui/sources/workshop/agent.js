/* agent.js · a simulated Claude Code, so the loop can be tried without one.
   Each agent waits on `slop comments wait --project <id>`. When someone opens a thread on a page in its project,
   it reads the comment and the element it points at (selector and computed styles), writes a CSS change for the
   words it knows, pushes the next version and replies on the thread. It knows a dozen words; anything else gets
   an honest reply. On slop.computer this is your real Claude Code with the slop CLI. */
(function () {
  'use strict';
  const api = window.slop;
  const A = window.SlopAgent = { enabled: true, busy: new Set(), queue: [] };
  const px = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
  const r = n => Math.round(n);
  const say = (agent, kind, text) => api.console.add({ who: agent.name, kind, text });

  // words → CSS, using the element's computed styles so the change is relative to what is there
  const RULES = [
    { re: /(too much (air|space|room)|tighter|less (space|air|room|padding)|denser|closer together|too far apart|cramp)/i, plan: s => {
      const out = [], g = px(s.columnGap) || px(s.gap) || px(s.rowGap);
      if (g) out.push({ decl: `gap:${r(g / 2)}px`, says: `gap ${r(g)}px → ${r(g / 2)}px` });
      const pt = px(s.paddingTop), pb = px(s.paddingBottom);
      if (pt + pb > 8) out.push({ decl: `padding-top:${r(pt * 0.6)}px;padding-bottom:${r(pb * 0.6)}px`, says: `padding ${r(pt)}px → ${r(pt * 0.6)}px` });
      if (!out.length) out.push({ decl: 'margin-top:0;margin-bottom:0;line-height:1.2', says: 'margins removed and line height tightened' });
      return out; } },
    { re: /(more (air|space|room)|looser|breathe|airier|crowded|too tight|cramped)/i, plan: s => {
      const out = [], g = px(s.columnGap) || px(s.gap);
      if (g) out.push({ decl: `gap:${r(g * 1.5)}px`, says: `gap ${r(g)}px → ${r(g * 1.5)}px` });
      const pt = px(s.paddingTop) || 8;
      out.push({ decl: `padding-top:${r(pt * 1.5)}px;padding-bottom:${r(pt * 1.5)}px`, says: `padding ${r(px(s.paddingTop))}px → ${r(pt * 1.5)}px` });
      return out; } },
    { re: /(bigger|larger|too small|increase|hard to read)/i, plan: s => [{ decl: `font-size:${r(px(s.fontSize) * 1.25)}px`, says: `type ${r(px(s.fontSize))}px → ${r(px(s.fontSize) * 1.25)}px` }] },
    { re: /(smaller|too big|too large|too loud|tone it down|quieter|shrink)/i, plan: s => {
      const out = [{ decl: `font-size:${r(px(s.fontSize) * 0.8)}px`, says: `type ${r(px(s.fontSize))}px → ${r(px(s.fontSize) * 0.8)}px` }];
      if (px(s.paddingTop) > 16) out.push({ decl: `padding-top:${r(px(s.paddingTop) * 0.6)}px;padding-bottom:${r(px(s.paddingBottom) * 0.6)}px`, says: `padding ${r(px(s.paddingTop))}px → ${r(px(s.paddingTop) * 0.6)}px` });
      return out; } },
    { re: /\b(bold|bolder|heavier|stronger weight)\b/i, plan: () => [{ decl: 'font-weight:700', says: 'bold' }] },
    { re: /\b(thinner|less bold|lighter weight|regular weight)\b/i, plan: () => [{ decl: 'font-weight:400', says: 'regular weight' }] },
    { re: /\bmono(space)?\b/i, plan: () => [{ decl: 'font-family:var(--mono);letter-spacing:0', says: 'set in the mono face' }] },
    { re: /\bcent(er|re)(ed)?\b/i, plan: () => [{ decl: 'text-align:center;justify-content:center', says: 'centred' }] },
    { re: /\b(left[- ]align|align left)\b/i, plan: () => [{ decl: 'text-align:left', says: 'aligned left' }] },
    { re: /\b(hide|remove|delete|get rid of|drop)\b/i, plan: () => [{ decl: 'display:none', says: 'hidden' }] },
    { re: /\b(invert|inverted|darker|dark background|black background)\b/i, plan: () => [{ decl: 'background:var(--ink);color:var(--wall)', says: 'inverted to ink' }] },
    { re: /\b(stand out|win|highlight|emphasi[sz]e|pop)\b/i, plan: () => [{ decl: 'background:var(--sky);outline:8px solid var(--sky)', says: 'set on sky' }] },
    { re: /\b(upper ?case|all caps|capitals)\b/i, plan: () => [{ decl: 'text-transform:uppercase;letter-spacing:.06em', says: 'uppercase, tracked .06em' }] },
    { re: /\bunderline/i, plan: () => [{ decl: 'text-decoration:underline;text-underline-offset:4px', says: 'underlined' }] },
    { re: /\b(rounded|round corners|softer corners)\b/i, plan: () => [{ decl: 'border-radius:12px', says: 'corners 12px' }] },
    { re: /\b(square|sharp corners)\b/i, plan: () => [{ decl: 'border-radius:0', says: 'square corners' }] },
    { re: /\b(blue)\b/i, plan: () => [{ decl: 'color:var(--accent)', says: 'blue from the tokens' }] },
    { re: /\b(muted|grey|gray|quieter colou?r)\b/i, plan: () => [{ decl: 'color:var(--muted)', says: 'muted' }] },
    { re: /(#[0-9a-f]{6}\b|#[0-9a-f]{3}\b)/i, plan: (s, m) => [{ decl: `color:${m[1]}`, says: `colour ${m[1]}` }] },
  ];
  const ON_PHONES = /\b(on (a )?phones?|on mobile|small screens?)\b/i;

  function plan(text, styles) {
    const steps = [];
    for (const rule of RULES) { const m = rule.re.exec(text); if (m) steps.push(...rule.plan(styles || {}, m)); }
    return steps;
  }
  function agentFor(artifactId) {
    const a = api.artifacts.get(artifactId); if (!a) return null;
    return api.agents.list().find(x => x.project === a.project) || null;
  }
  A.agentFor = agentFor;

  function handle(thread) {
    const agent = agentFor(thread.artifact);
    if (!agent || !A.enabled) return;
    const art = api.artifacts.get(thread.artifact);
    const first = thread.comments[0];
    const who = (api.users.get(thread.by) || {}).name || thread.by;
    A.busy.add(agent.id); api.emit('agent', { agent, state: 'reading', thread });
    say(agent, 'out', JSON.stringify({ thread: thread.id, artifact: thread.artifact, version: thread.version, by: who, text: first.text, anchor: thread.anchor && thread.anchor.selector ? { selector: thread.anchor.selector } : thread.anchor }));
    setTimeout(() => {
      if (art.kind !== 'page') {
        api.comments.reply(thread.id, { by: agent.owner, agent: true, text: 'In this prototype I only change pages. For a record, edit it in the Records tab, or push the file with slop push.' });
        say(agent, 'note', 'data comment: replied, no change');
        return done(agent);
      }
      const main = api.versions.main(thread.artifact);
      const html = main.files['index.html'] || '';
      say(agent, 'note', `reading ${thread.artifact} v${main.n} · ${Object.keys(main.files).map(f => `${f} ${Math.max(1, Math.round(main.files[f].length / 1024))} KB`).join(', ')}`);
      api.emit('agent', { agent, state: 'writing', thread });
      setTimeout(() => {
        const sel = thread.anchor && thread.anchor.selector;
        const steps = sel ? plan(first.text, thread.anchor.styles) : [];
        if (!steps.length) {
          api.comments.reply(thread.id, { by: agent.owner, agent: true, text: `I read that, but this simulated agent only knows a few words: tighter, more space, bigger, smaller, bold, mono, centre, hide, invert, stand out, uppercase, rounded, square, blue, muted or a #hex colour. Try one of those${sel ? '' : ', and point at an element'}.` });
          say(agent, 'note', 'no change: did not recognise what to do');
          return done(agent);
        }
        const phones = ON_PHONES.test(first.text);
        const rule = `${sel}{${steps.map(s => s.decl.split(';').map(d => d + ' !important').join(';')).join(';')}}`;
        const css = `\n<style data-agent="${agent.id}">/* ${agent.name}, from ${who}'s comment ${thread.id}: ${first.text.replace(/\*\//g, '')} */\n${phones ? `@media (max-width:900px){${rule}}` : rule}\n</style>\n`;
        const next = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, css + '</body>') : html + css;
        const what = steps.map(s => s.says).join(', ') + ` on ${sel}` + (phones ? ' (phones only)' : '');
        const message = what.charAt(0).toUpperCase() + what.slice(1);
        say(agent, 'cmd', `slop push ./${thread.artifact} -a ${thread.artifact} -m "${message.replace(/"/g, '\\"')}" --reply ${thread.id}`);
        const out = api.push(thread.artifact, { files: { 'index.html': next }, message, by: agent.owner, via: 'claude', session: agent.session, reply: thread.id });
        const n = out.version.n;
        const routes = api.routes.using(thread.artifact);
        const live = routes.filter(r => !r.version), pinned = routes.filter(r => r.version);
        let tail = '';
        if (live.length) tail = ` It is live at ${live.map(r => r.path).join(', ')} already, since that route follows main.`;
        else if (pinned.length) tail = ` ${pinned.map(r => r.path).join(', ')} still serves v${pinned[0].version}; point it at v${n} when it looks right.`;
        api.comments.reply(thread.id, { by: agent.owner, agent: true, version: n, text: `Done in v${n}: ${what}.${tail}` });
        say(agent, 'out', `pushed ${thread.artifact} v${n} · 1 file changed · replied on ${thread.id}`);
        done(agent);
      }, 1700);
    }, 1300);
  }
  function done(agent) {
    A.busy.delete(agent.id);
    api.emit('agent', { agent, state: 'listening' });
    say(agent, 'cmd', `slop comments wait --project ${agent.project}`);
    const next = A.queue.findIndex(t => agentFor(t.artifact) === agent);
    if (next >= 0) { const [t] = A.queue.splice(next, 1); setTimeout(() => handle(t), 400); }
  }

  api.on('thread.create', ev => {
    const th = ev.thread;
    if (!A.enabled) return;
    const agent = agentFor(th.artifact); if (!agent) return;
    if (A.busy.has(agent.id)) { A.queue.push(th); return; }
    setTimeout(() => handle(th), 700);
  });
  A.setEnabled = on => { A.enabled = on; api.emit('agent', { state: on ? 'listening' : 'off' }); };
})();
