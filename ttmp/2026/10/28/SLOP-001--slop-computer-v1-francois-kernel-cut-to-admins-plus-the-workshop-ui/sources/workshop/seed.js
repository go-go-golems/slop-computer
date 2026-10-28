/* seed.js · fake data for the slop.computer prototype.
   Example pages for a lab site (in slop.boutique's Final design), each with a version history; data artifacts
   (journal posts as Markdown, experiments as JSON, design tokens); routes on two hosts; people, tokens, comments.
   Everything here is invented. Pages are standalone HTML: each version is a file tree (index.html + boutique.css),
   and pages read their data through window.slop, which the server injects. */
(function () {
  'use strict';
  const BCSS = window.BOUTIQUE_CSS;
  const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

  // ------------------------------------------------------------------ helpers that run inside every lab page
  function pageLib() {
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const D = d => new Date(String(d).slice(0, 10) + 'T12:00:00Z');
    window.lab = {
      esc,
      day: d => D(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      long: d => D(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
      month: d => D(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      iso: d => String(d).slice(0, 10),
      data: async name => (window.slop && slop.data && slop.data[name]) ? await slop.data[name].list() : [],
      one: async (name, id) => (window.slop && slop.data && slop.data[name]) ? await slop.data[name].get(id) : null,
      params: () => (window.slop && slop.route && slop.route.params) || {},
      // generative cover: soft bands in the experiment's colours, seeded by its id
      art(canvas, colors, seed, t) {
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        let s = 0; for (const ch of String(seed || 'x')) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
        const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
        const cols = (colors && colors.length ? colors : ['#2F2D2A', '#CEE5FF', '#F4F3F0']);
        c.fillStyle = cols[cols.length - 1]; c.fillRect(0, 0, w, h);
        const n = 7;
        for (let i = 0; i < n; i++) {
          const y0 = r() * h, amp = (0.08 + r() * 0.2) * h, fr = 1 + r() * 2.5, ph = r() * 6.28 + (t || 0) * (0.2 + r() * 0.3);
          c.beginPath(); c.moveTo(0, h);
          for (let x = 0; x <= w; x += 8) c.lineTo(x, y0 + Math.sin(x / w * fr * 6.28 + ph) * amp);
          c.lineTo(w, h); c.closePath();
          c.globalAlpha = 0.55; c.fillStyle = cols[i % (cols.length - 1 || 1)]; c.fill();
        }
        c.globalAlpha = 1;
      },
    };
  }

  const FOOT = `<footer class="site-footer page">
  <div class="footer-brand"><span class="site-wordmark">slop.boutique</span><span>Run by Manuel and Ramon.</span></div>
  <div><a href="/">Apps</a><a href="/journal">Journal</a><a href="/about">About</a></div>
  <div><a href="/journal">RSS</a><a href="/press">Press</a><a href="/pricing">Support the lab</a></div>
  <div class="footer-type"><span>Set in ABC Areal.</span><span>For humans.</span></div>
</footer>`;

  // A complete lab page. o: { title, active, main, css, script (a function run in the page), opts, statement }
  function page(o) {
    const nav = [['/', 'Apps', 'apps'], ['/journal', 'Journal', 'journal'], ['/about', 'About', 'about']];
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${o.title}</title>
<link rel="stylesheet" href="boutique.css">${o.css ? `\n<style>${o.css}</style>` : ''}
</head><body><div class="sb-app">
<header class="site-header page"><a class="site-wordmark" href="/">slop.boutique</a><p class="site-statement">${o.statement || 'A lab for computation and intelligence as material and medium.'}</p>
<nav class="site-nav">${nav.map(([h, l, k]) => `<a href="${h}"${o.active === k ? ' aria-current="page" style="color:var(--ink)"' : ''}>${l}</a>`).join('')}<a class="site-support" href="/pricing"><span class="support-desktop">Support the lab</span><span class="support-mobile">Support</span></a></nav></header>
<main class="sb-main page">${o.main}</main>
${FOOT}
</div>
<script>(${pageLib})();</script>${o.script ? `\n<script>(${o.script})(${JSON.stringify(o.opts || {})});</script>` : ''}
</body></html>
`;
  }
  const files = html => ({ 'index.html': html, 'boutique.css': BCSS });

  // ------------------------------------------------------------------ front page
  function frontScript(o) {
    (async () => {
      const L = window.lab, rows = document.getElementById('rows');
      const exps = (await L.data('experiments')).slice(), posts = (await L.data('posts')).slice();
      document.getElementById('count').textContent = 'Run by Manuel and Ramon. ' + exps.length + ' experiments so far.';
      let q = '', tag = null, sort = 'new';
      const draw = () => {
        let xs = exps.filter(e => (!tag || e.tags.includes(tag)) && (!q || (e.title + ' ' + e.summary + ' ' + e.tags.join(' ')).toLowerCase().includes(q)));
        xs.sort((a, b) => sort === 'az' ? a.title.localeCompare(b.title) : sort === 'old' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
        rows.innerHTML = xs.map(e => `<a class="archive-row" href="/apps/${e.id}"><div class="cell c-number"><span class="archive-number">${String(e.no).padStart(3, '0')}</span></div><div class="cell c-title"><p class="sb-title">${L.esc(e.title)}</p>${o.summaries ? `<p class="sb-snippet">${L.esc(e.summary)}</p>` : ''}</div><div class="cell c-tags"><span class="archive-tags">${e.tags.join(', ')}</span></div><div class="cell c-date"><span class="archive-date">${L.day(e.date)}</span></div></a>`).join('')
          || '<div class="archive-empty"><p>Nothing matches that.</p><p class="muted">Try another word or another tag.</p></div>';
      };
      if (o.controls) {
        const counts = {}; exps.forEach(e => e.tags.forEach(t => counts[t] = (counts[t] || 0) + 1));
        const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 7);
        const cats = document.getElementById('cats');
        const drawCats = () => { cats.innerHTML = `<a href="#" data-t=""${!tag ? ' aria-current="true"' : ''}>All</a>` + tags.map(t => `<a href="#" data-t="${t}"${tag === t ? ' aria-current="true"' : ''}>${t} <span class="sb-count">${counts[t]}</span></a>`).join(''); };
        drawCats();
        cats.addEventListener('click', e => { const a = e.target.closest('a[data-t]'); if (!a) return; e.preventDefault(); e.stopPropagation(); tag = a.dataset.t || null; drawCats(); draw(); }, true);
        document.getElementById('q').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); draw(); });
        document.getElementById('sort').addEventListener('change', e => { sort = e.target.value; draw(); });
      }
      if (o.journal) {
        posts.sort((a, b) => b.date.localeCompare(a.date));
        document.getElementById('feed').innerHTML = posts.slice(0, 3).map(p => `<a class="sb-feed-item" href="/journal/${p.id}"><p class="sb-kicker">${L.long(p.date)}</p><h3 class="sb-title">${L.esc(p.title)}</h3><p class="sb-snippet">${L.esc(p.summary)}</p></a>`).join('');
      }
      draw();
    })();
  }
  function frontPage(o) {
    return page({
      title: 'slop.boutique', active: 'apps', opts: o, script: frontScript,
      main: `<section class="sb-intro"><h1 class="sb-h1">${o.headline}</h1><p class="sb-text" id="count">&nbsp;</p></section>
${o.controls ? `<div class="archive-controls"><label class="archive-search"><input id="q" type="search" placeholder="Search experiments" aria-label="Search experiments"><span class="sb-search-icon" aria-hidden="true">&#9906;</span></label><nav class="archive-categories" id="cats" aria-label="Tags"></nav><div class="archive-sort"><label for="sort">Sort</label><select id="sort"><option value="new">Newest</option><option value="old">Oldest</option><option value="az">A to Z</option></select></div></div>` : ''}
<div class="archive-list" id="rows"${o.controls ? '' : ' style="border-top:1px solid var(--ink);margin-top:24px"'}></div>
${o.journal ? `<p class="final-label">From the journal</p><div class="sb-feed" id="feed" style="padding-top:0"></div>` : ''}
${o.callout ? `<section class="support-callout"><p class="callout-label">Support</p><div><h2>Keep the lab running.</h2><p>The lab is paid for by the people who use it: no ads, no clients, no investors. Supporters run every experiment in the browser.</p><a class="site-button callout-button" href="/pricing">Support the lab</a></div></section>` : ''}`,
    });
  }

  // ------------------------------------------------------------------ experiment page (/apps/:slug)
  function appScript(o) {
    (async () => {
      const L = window.lab, el = document.getElementById('rec');
      const id = L.params().slug;
      const e = await L.one('experiments', id);
      if (!e) { el.innerHTML = `<p class="sb-kicker">Experiments</p><h1 class="sb-title t-h2">No experiment called “${L.esc(id || '')}”.</h1><p class="sb-text"><a class="u" href="/">See all experiments</a></p>`; return; }
      document.title = e.title + ' · slop.boutique';
      el.innerHTML = `<p class="sb-kicker"><a class="tlink quiet" href="/">Experiments</a> / ${String(e.no).padStart(3, '0')}</p>
<div class="sb-row"><h1 class="sb-title t-h1">${L.esc(e.title)}</h1><div class="experiment-download">${e.href ? `<a class="site-button" href="${e.href}">Open</a>` : '<span class="site-button" style="opacity:.55">Download HTML</span>'}<span class="file-meta">${e.size} · single HTML file</span></div></div>
<p class="experiment-description">${L.esc(e.summary)}</p>
<p class="byline">${e.kind} · released ${L.long(e.date)} · by ${e.by}</p>
<div class="experiment-runner"><div class="runner-toolbar"><span class="runner-state">${o.animate ? 'Running' : 'Cover'}</span><span class="runner-caption">${e.tags.join(', ')}</span></div><div class="runner-surface"><canvas id="art" width="1280" height="800"></canvas></div></div>
<section class="experiment-editorial">
  <div class="editorial-row"><p class="editorial-label">What it is</p><div class="editorial-body"><p>${L.esc(e.what || e.summary)}</p></div></div>
  <div class="editorial-row"><p class="editorial-label">Tags</p><div class="editorial-body"><p>${e.tags.map(t => `<span class="sb-badge">${t}</span>`).join(' ')}</p></div></div>
  ${o.more ? '<div class="editorial-row"><p class="editorial-label">More like this</p><div class="editorial-body"><div class="lines" id="more"></div></div></div>' : ''}
</section>`;
      const cv = document.getElementById('art');
      let t = 0; const tick = () => { L.art(cv, e.colors, e.id, t); if (o.animate) { t += 0.02; requestAnimationFrame(tick); } }; tick();
      if (o.more) {
        const all = await L.data('experiments');
        const like = all.filter(x => x.id !== e.id && x.tags.some(t => e.tags.includes(t))).slice(0, 3);
        document.getElementById('more').innerHTML = like.map(x => `<a class="line" href="/apps/${x.id}"><span class="line-label">${L.esc(x.title)}</span><span class="line-body"><span class="muted">${L.esc(x.summary)}</span></span></a>`).join('') || '<p class="muted">Nothing shares a tag yet.</p>';
      }
    })();
  }
  const appPage = o => page({ title: 'Experiment · slop.boutique', active: 'apps', opts: o, script: appScript, main: '<article class="sb-record" id="rec"></article>' });

  // ------------------------------------------------------------------ pricing
  const TIERS = [
    { name: 'Reader', m: 'Free', y: 'Free', per: '', blurb: 'Read about every experiment and the journal.', items: ['Every experiment’s page', 'The journal and its feed', 'Free samples to download'], cta: 'Start reading', href: '/' },
    { name: 'Supporter', m: '€8', y: '€80', per: 'a month', perY: 'a year', blurb: 'Run the experiments in your browser.', items: ['Everything for readers', 'Run every experiment', 'Model credits for about 200 runs a month', 'Early access to new work'], cta: 'Support the lab', href: '/pricing' },
    { name: 'Studio', m: '€24', y: '€240', per: 'a month', perY: 'a year', blurb: 'For a small team that builds on the lab’s work.', items: ['Everything for supporters', 'Five shared instances', 'Downloads of every release', 'Requests get read first'], cta: 'Talk to us', href: '/about' },
  ];
  const FAQ = [
    ['Can I cancel?', 'Yes, at any time. You keep access until the end of the period you paid for.'],
    ['What are model credits?', 'Experiments that call a model spend credits. A typical run costs one; heavy ones say how many before they start.'],
    ['Do you sell my data?', 'No. There are no ads and no trackers beyond counting page views.'],
  ];
  function pricingScript(o) {
    if (!o.toggle) return;
    const seg = document.getElementById('period');
    seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      const y = b.dataset.p === 'y';
      document.querySelectorAll('.amt').forEach(a => { a.textContent = y ? a.dataset.y : a.dataset.m; });
      document.querySelectorAll('.per').forEach(p => { p.textContent = y ? p.dataset.y : p.dataset.m; });
    });
  }
  function pricing(o) {
    const css = `.tiers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:${o.gap}px;padding:${o.toggle ? 24 : 32}px 0 0}
.tier{border-top:1px solid var(--ink);padding:20px 0 28px;display:flex;flex-direction:column;gap:12px;position:relative;min-width:0}
.tier-name{margin:0;font-size:15px;color:var(--muted)}
.tier-price{margin:0;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.amt{font-size:${o.big ? 64 : 40}px;line-height:1;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.per{color:var(--muted);font-size:15px}
.tier-blurb{margin:0;font-size:17px}
.tier ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;font-size:15px;color:var(--muted)}
.tier li{padding-left:16px;position:relative}.tier li::before{content:"–";position:absolute;left:0}
.tier .site-button{align-self:flex-start;margin-top:12px}
.tier .sb-badge{position:absolute;top:20px;right:${o.emph === 'invert' ? 20 : 0}px}
${o.emph === 'sky' ? '.tier.mid{background:var(--sky);padding:20px 20px 28px}' : ''}
${o.emph === 'invert' ? '.tier.mid{background:var(--ink);color:var(--wall);padding:20px 20px 28px}.tier.mid .tier-name,.tier.mid .per,.tier.mid ul{color:var(--faint)}.tier.mid .site-button{background:var(--sky);color:var(--ink)}' : ''}
${o.phoneFirst ? '@media (max-width:900px){.tier.mid{order:-1}}' : ''}
@media (max-width:900px){.tiers{grid-template-columns:1fr;gap:${Math.min(o.gap, 24)}px}}`;
    const tiers = TIERS.map((t, i) => `<div class="tier${i === 1 ? ' mid' : ''}"><p class="tier-name">${t.name}</p><p class="tier-price"><span class="amt" data-m="${t.m}" data-y="${t.y}">${t.m}</span><span class="per" data-m="${t.per}" data-y="${t.perY || t.per}">${t.per}</span></p><p class="tier-blurb">${t.blurb}</p><ul>${t.items.map(x => `<li>${x}</li>`).join('')}</ul><a class="site-button" href="${t.href}">${t.cta}</a>${i === 1 && o.badge ? '<span class="sb-badge">Most people pick this</span>' : ''}</div>`).join('');
    return page({
      title: 'Support the lab · slop.boutique', css, opts: o, script: pricingScript,
      main: `<section class="sb-intro"><h1 class="sb-h1">${o.headline}</h1><p class="sb-text">${o.lede}</p></section>
${o.toggle ? '<div class="seg" id="period"><button aria-pressed="true" data-p="m">Monthly</button><button aria-pressed="false" data-p="y">Yearly, two months free</button></div>' : ''}
<section class="tiers">${tiers}</section>
${o.faq ? `<p class="final-label">Questions</p><div class="lines">${FAQ.map(([q, a]) => `<div class="line"><p class="line-label">${q}</p><div class="line-body"><div class="prose"><p>${a}</p></div></div></div>`).join('')}</div>` : ''}`,
    });
  }

  // ------------------------------------------------------------------ about
  function aboutScript(o) {
    (async () => {
      if (!o.stats) return;
      const L = window.lab, exps = await L.data('experiments'), posts = await L.data('posts');
      document.getElementById('nexp').textContent = exps.length;
      document.getElementById('npost').textContent = posts.length;
    })();
  }
  const about = o => page({
    title: 'About · slop.boutique', active: 'about', opts: o, script: aboutScript,
    main: `<section class="sb-intro"><h1 class="sb-h1">Two people, and a lot of agents.</h1><p class="sb-text">We make small programs about computation and intelligence, mostly in one HTML file each, and put them here for people to use and take apart.</p></section>
<div class="lines">
  <div class="line"><p class="line-label">Manuel</p><div class="line-body"><p>Builds workbenches, compilers and the hosting under this lab.</p><p class="muted small">Runs the servers, writes the grammars, answers the support mail.</p></div></div>
  <div class="line"><p class="line-label">Ramon</p><div class="line-body"><p>Designs the surfaces, and the headless apps behind them.</p><p class="muted small">Decides how things look and what they leave out.</p></div></div>
</div>
${o.stats ? '<p class="final-label">So far</p><div class="sb-stats"><div class="sb-stat"><div class="sb-stat-n" id="nexp">–</div><div class="sb-stat-l">experiments</div></div><div class="sb-stat"><div class="sb-stat-n" id="npost">–</div><div class="sb-stat-l">journal posts</div></div><div class="sb-stat"><div class="sb-stat-n">2</div><div class="sb-stat-l">people</div></div></div>' : ''}
${o.how ? `<section class="experiment-editorial">
  <div class="editorial-row"><p class="editorial-label">How we work</p><div class="editorial-body"><p>Every page on this site is an artifact with a version history. Agents push new versions; one of us looks, comments, and decides which version a page shows.</p></div></div>
  <div class="editorial-row"><p class="editorial-label">Taking things apart</p><div class="editorial-body"><p>Download an experiment and hand it to your own coding agent. That is what they are for.</p></div></div>
  <div class="editorial-row"><p class="editorial-label">Writing to us</p><div class="editorial-body"><p>hello@slop.boutique, read by both of us.</p></div></div>
</section>` : ''}`,
  });

  // ------------------------------------------------------------------ journal index and post
  function journalScript(o) {
    (async () => {
      const L = window.lab, el = document.getElementById('feed');
      const posts = (await L.data('posts')).filter(p => !p.draft).sort((a, b) => b.date.localeCompare(a.date));
      document.getElementById('jcount').textContent = posts.length + ' posts';
      if (!o.group) {
        el.className = 'sb-list';
        el.innerHTML = posts.map(p => `<a class="sb-list-row" href="/journal/${p.id}"><span class="sb-title">${L.esc(p.title)}</span><span class="sb-caption${o.mono ? ' sb-version' : ''}">${o.mono ? L.iso(p.date) : L.day(p.date)}</span></a>`).join('');
        return;
      }
      let last = '', html = '';
      posts.forEach((p, i) => {
        const m = L.month(p.date);
        if (m !== last) { html += `<h2 class="sb-feed-day">${m}</h2>`; last = m; }
        html += `<a class="sb-feed-item" href="/journal/${p.id}">
          ${o.covers && i < 3 ? `<canvas class="sb-cover" width="1120" height="700" data-c="${(p.colors || []).join(',')}" data-id="${p.id}"></canvas>` : ''}
          <p class="sb-kicker${o.mono ? ' sb-version' : ''}">${o.mono ? L.iso(p.date) : L.long(p.date)}${o.time ? ' · ' + p.minutes + ' min read' : ''}</p>
          <h3 class="sb-title">${L.esc(p.title)}</h3>
          ${o.summaries ? `<p class="sb-snippet">${L.esc(p.summary)}</p>` : ''}
          ${o.tags ? `<div class="sb-chips">${p.tags.map(t => `<span class="muted">#${t}</span>`).join('')}</div>` : ''}
        </a>`;
      });
      el.innerHTML = html;
      el.querySelectorAll('canvas[data-id]').forEach(cv => L.art(cv, cv.dataset.c ? cv.dataset.c.split(',') : null, cv.dataset.id, 0));
    })();
  }
  const journalIndex = o => page({
    title: 'Journal · slop.boutique', active: 'journal', opts: o, script: journalScript,
    css: '.sb-feed-item canvas.sb-cover{max-width:560px;height:auto}',
    main: `<section class="sb-intro"><h1 class="sb-h1">Journal</h1><p class="sb-text">Notes from the lab, as we build it. <span id="jcount"></span></p></section><div class="sb-feed" id="feed" style="padding-top:0"></div>`,
  });
  function postScript(o) {
    (async () => {
      const L = window.lab, el = document.getElementById('post');
      const id = L.params().slug;
      const p = await L.one('posts', id);
      if (!p) { el.innerHTML = `<p class="sb-kicker">Journal</p><h1>No post called “${L.esc(id || '')}”.</h1><p><a class="u" href="/journal">All posts</a></p>`; return; }
      document.title = p.title + ' · slop.boutique';
      el.innerHTML = `<p class="sb-kicker"><a class="tlink quiet" href="/journal">Journal</a> · <span${o.mono ? ' class="sb-version"' : ''}>${o.mono ? L.iso(p.date) : L.long(p.date)}</span>${o.time ? ' · ' + p.minutes + ' min read' : ''}</p>
<h1>${L.esc(p.title)}</h1>
<p class="byline" style="margin:-6px 0 24px">by ${L.esc(p.author || 'Manuel and Ramon')}</p>
<div class="prose">${p.html}</div>
${o.tags ? `<div class="sb-chips" style="margin-top:20px">${p.tags.map(t => `<span class="sb-badge">${t}</span>`).join('')}</div>` : ''}`;
      if (o.nav) {
        const all = (await L.data('posts')).sort((a, b) => a.date.localeCompare(b.date));
        const i = all.findIndex(x => x.id === p.id), prev = all[i - 1], next = all[i + 1];
        document.getElementById('pn').innerHTML = `<div class="lines">${prev ? `<a class="line" href="/journal/${prev.id}"><span class="line-label">Earlier</span><span class="line-body">${L.esc(prev.title)}</span></a>` : ''}${next ? `<a class="line" href="/journal/${next.id}"><span class="line-label">Later</span><span class="line-body">${L.esc(next.title)}</span></a>` : ''}</div>`;
      }
    })();
  }
  const journalPost = o => page({
    title: 'Journal · slop.boutique', active: 'journal', opts: o, script: postScript,
    main: `<article class="sb-prose" id="post" style="padding-top:56px"></article>${o.nav ? '<div id="pn" style="margin-top:56px;max-width:880px"></div>' : ''}`,
  });

  // ------------------------------------------------------------------ not found, press
  function notFoundScript() { const el = document.getElementById('path'); if (el) el.textContent = (window.slop && slop.route && slop.route.path) || location.pathname; }
  const notFound = () => page({
    title: 'Not found · slop.boutique', script: notFoundScript,
    main: `<section class="sb-intro"><p class="sb-kicker">404</p><h1 class="sb-h1">Nothing lives at <span id="path" class="sb-v">this address</span> yet.</h1><p class="sb-text">Every page on this site is an artifact, and no route points one at this path.</p></section>
<div class="lines"><a class="line" href="/"><span class="line-label">Experiments</span><span class="line-body muted">Everything the lab has made</span></a><a class="line" href="/journal"><span class="line-label">Journal</span><span class="line-body muted">Notes as we build</span></a></div>`,
  });
  const pressKit = () => page({
    title: 'Press · slop.boutique',
    css: '.marks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.mark{aspect-ratio:8/5;display:grid;place-items:center;border-radius:3px;font-weight:500;font-size:22px;letter-spacing:-.01em}.mark.a{background:var(--plinth)}.mark.b{background:var(--ink);color:var(--wall)}.mark.c{background:var(--sky)}@media (max-width:900px){.marks{grid-template-columns:1fr}}',
    main: `<section class="sb-intro"><h1 class="sb-h1">Press</h1><p class="sb-text">Everything you need to write about the lab, in one place.</p></section>
<div class="lines">
  <div class="line"><p class="line-label">In one sentence</p><div class="line-body"><p>slop.boutique is a lab for computation and intelligence as material and medium, run by Manuel and Ramon.</p></div></div>
  <div class="line"><p class="line-label">Contact</p><div class="line-body"><p>press@slop.boutique</p><p class="muted small">We answer within two working days.</p></div></div>
  <div class="line"><p class="line-label">Wordmark</p><div class="line-body"><div class="marks"><div class="mark a">slop.boutique</div><div class="mark b">slop.boutique</div><div class="mark c">slop.boutique</div></div></div></div>
</div>`,
  });

  // ------------------------------------------------------------------ play: orbits, type specimen, pomodoro
  function orbitsScript(o) {
    const cv = document.getElementById('orb'), c = cv.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const col = n => (css.getPropertyValue(n) || '').trim();
    let n = o.bodies, speed = 1, trails = !!o.trails, t = 0, bodies = [];
    const make = () => { bodies = []; for (let i = 0; i < n; i++) bodies.push({ r: 70 + i * (300 / n) + (i % 3) * 9, a: i * 2.399, w: 0.9 / Math.sqrt(1 + i * 0.6), s: 3 + (i % 4) * 2 }); };
    make();
    const W = cv.width, H = cv.height;
    const frame = () => {
      if (trails) { c.fillStyle = 'rgba(255,255,255,0.10)'; if (o.dark) c.fillStyle = 'rgba(20,20,22,0.12)'; c.fillRect(0, 0, W, H); }
      else { c.fillStyle = o.dark ? '#141416' : (col('--table') || '#EEECE8'); c.fillRect(0, 0, W, H); }
      c.save(); c.translate(W / 2, H / 2);
      c.fillStyle = o.dark ? '#F2C14E' : (col('--ink') || '#2F2D2A'); c.beginPath(); c.arc(0, 0, 18, 0, 6.283); c.fill();
      bodies.forEach((b, i) => {
        const a = b.a + t * b.w;
        if (!trails) { c.strokeStyle = o.dark ? 'rgba(255,255,255,.08)' : (col('--line') || '#E7E5E1'); c.beginPath(); c.arc(0, 0, b.r, 0, 6.283); c.stroke(); }
        c.fillStyle = i % 3 === 0 ? (col('--accent') || '#2340D8') : (o.dark ? '#E9E6DF' : (col('--ink') || '#2F2D2A'));
        c.beginPath(); c.arc(Math.cos(a) * b.r, Math.sin(a) * b.r * 0.62, b.s, 0, 6.283); c.fill();
      });
      c.restore();
      t += 0.01 * speed; requestAnimationFrame(frame);
    };
    frame();
    const out = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    document.getElementById('nb').addEventListener('input', e => { n = +e.target.value; out('nbv', n); make(); });
    document.getElementById('sp').addEventListener('input', e => { speed = +e.target.value; out('spv', speed.toFixed(1) + '×'); });
    const tr = document.getElementById('tr'); if (tr) tr.addEventListener('change', e => { trails = e.target.checked; });
  }
  const orbits = o => page({
    title: 'Orbits · slop.boutique', active: 'apps', opts: o, script: orbitsScript,
    css: '#orb{display:block;width:100%;height:100%}.runner-tools{flex-wrap:wrap}',
    main: `<article class="sb-record"><p class="sb-kicker"><a class="tlink quiet" href="/">Experiments</a> / 011</p><h1 class="sb-title t-h1">Orbits</h1>
<p class="experiment-description">Bodies in orbit around one sun. Change how many there are and how fast they go${o.trails ? ', and let them leave trails' : ''}.</p>
<div class="experiment-runner"><div class="runner-toolbar"><span class="runner-state" style="--x:1">Running</span><div class="runner-tools">
<label class="sb-slider">Bodies <output id="nbv">${o.bodies}</output><input id="nb" type="range" min="1" max="24" value="${o.bodies}"></label>
<label class="sb-slider">Speed <output id="spv">1.0×</output><input id="sp" type="range" min="0.2" max="4" step="0.1" value="1"></label>
${o.trailsToggle ? `<label class="sb-toggle"><input id="tr" type="checkbox"${o.trails ? ' checked' : ''}> Trails</label>` : ''}
</div></div><div class="runner-surface"${o.dark ? ' style="background:#141416"' : ''}><canvas id="orb" width="1280" height="800"></canvas></div></div></article>`,
  });
  function typeScript(o) {
    const lines = [...document.querySelectorAll('[data-size]')];
    const set = () => {
      const txt = document.getElementById('tx').value || 'A lab for computation';
      const w = document.getElementById('wt').value, sc = +document.getElementById('sz').value;
      document.getElementById('szv').textContent = sc.toFixed(2) + '×';
      lines.forEach(l => { const s = +l.dataset.size * sc; l.querySelector('.spec').textContent = txt; l.querySelector('.spec').style.fontSize = s + 'px'; l.querySelector('.spec').style.fontWeight = w; l.querySelector('.px').textContent = Math.round(s) + ' px'; });
    };
    ['tx', 'wt', 'sz'].forEach(id => document.getElementById(id).addEventListener('input', set));
    const m = document.getElementById('mono'); if (m) m.addEventListener('change', e => { document.querySelectorAll('.spec').forEach(s => s.style.fontFamily = e.target.checked ? 'var(--mono)' : ''); });
    set();
  }
  const typeSpecimen = o => page({
    title: 'Type Specimen · slop.boutique', active: 'apps', opts: o, script: typeScript,
    css: '.specs{border-top:1px solid var(--ink)}.specs .line{align-items:baseline}.spec{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.02em;line-height:1.05;display:block}.ctl{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-end;padding:8px 0 24px}.ctl input[type=text]{border:1px solid var(--line);border-radius:3px;padding:8px 10px;min-width:260px}',
    main: `<section class="sb-intro"><p class="sb-kicker">Experiment 012</p><h1 class="sb-h1">Type Specimen</h1><p class="sb-text">The lab’s typeface at the sizes the site uses${o.waterfall ? ', from the largest heading to a caption' : ''}. Type your own line.</p></section>
<div class="ctl"><label class="sb-select">Text <input id="tx" type="text" value="A lab for computation"></label><label class="sb-select">Weight <select id="wt"><option value="400">Regular</option><option value="500">Medium</option><option value="700">Bold</option></select></label><label class="sb-slider">Scale <output id="szv">1.00×</output><input id="sz" type="range" min="0.5" max="1.6" step="0.05" value="1"></label>${o.mono ? '<label class="sb-toggle"><input id="mono" type="checkbox"> Mono</label>' : ''}</div>
<div class="lines specs">${(o.waterfall ? [96, 64, 48, 28, 20, 17, 15, 13] : [96, 48, 17]).map(s => `<div class="line" data-size="${s}"><span class="line-label"><span class="px">${s} px</span></span><span class="line-body" style="min-width:0;flex:1"><span class="spec"></span></span></div>`).join('')}</div>`,
  });
  function pomoScript(o) {
    let total = o.minutes * 60, left = total, on = false, done = 0, last = 0;
    const el = document.getElementById('clock'), btn = document.getElementById('go');
    const fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    const draw = () => { el.textContent = fmt(left); btn.textContent = on ? 'Pause' : (left < total ? 'Resume' : 'Start'); const d = document.getElementById('dots'); if (d) d.innerHTML = Array.from({ length: 4 }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join(''); };
    const tick = ts => { if (on) { if (last) left = Math.max(0, left - (ts - last) / 1000); last = ts; if (left === 0) { on = false; done = Math.min(4, done + 1); left = total; } } else last = 0; draw(); requestAnimationFrame(tick); };
    btn.addEventListener('click', () => { on = !on; draw(); });
    document.getElementById('reset').addEventListener('click', () => { on = false; left = total; draw(); });
    const mn = document.getElementById('mn'); if (mn) mn.addEventListener('input', e => { total = +e.target.value * 60; left = total; on = false; document.getElementById('mnv').textContent = e.target.value + ' min'; draw(); });
    requestAnimationFrame(tick);
  }
  const pomodoro = o => page({
    title: 'Pomodoro · slop.boutique', active: 'apps', opts: o, script: pomoScript,
    css: '#clock{font-size:clamp(96px,18vw,220px);line-height:.9;letter-spacing:-.05em;font-variant-numeric:tabular-nums;margin:24px 0}.pbar{display:flex;gap:16px;align-items:center;flex-wrap:wrap}.sb-deck-dots i{width:10px;height:10px}',
    main: `<article class="sb-record"><p class="sb-kicker"><a class="tlink quiet" href="/">Experiments</a> / 013</p><h1 class="sb-title t-h2">Pomodoro</h1>
<div id="clock">25:00</div>
<div class="pbar"><button class="site-button" id="go">Start</button><button class="site-button" id="reset" style="background:none;border:1px solid var(--line)">Reset</button>${o.sessions ? '<span class="sb-deck-dots" id="dots"></span><span class="muted small">four sessions, then a long break</span>' : ''}</div>
${o.sessions ? `<label class="sb-slider" style="max-width:320px;margin-top:28px">Session length <output id="mnv">${o.minutes} min</output><input id="mn" type="range" min="5" max="50" step="5" value="${o.minutes}"></label>` : ''}</article>`,
  });

  // ------------------------------------------------------------------ shells (slop.computer's own screens)
  const shell = (name, about) => ({
    'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name} · slop.computer</title><style>body{margin:0;font:13px/1.5 Arial,Helvetica,sans-serif;color:#1a1a1a;background:#fff;display:grid;place-items:center;min-height:100vh}div{max-width:420px;border-left:2px solid #1a1a1a;padding:6px 16px}b{font-size:15px}p{margin:6px 0 0;color:#737373}code{font:11px ui-monospace,Menlo,monospace}</style></head><body><div><b>${name}</b><p>${about}</p><p>This shell is the screen you are using in this prototype. On slop.computer it is served on the main origin with <code>window.slop</code>, the API bound to your session.</p></div></body></html>`,
  });

  // ------------------------------------------------------------------ data: experiments, journal, tokens
  const EXPERIMENTS = [
    ['saltmarsh', 'Saltmarsh', 'Simulation', '2026-09-30', '388 KB', ['simulation', 'ecology'], 'An ecosystem of grasses, crabs and tides that runs for a year in a minute.', ['#2F4A3A', '#9BB59A', '#E8E2CF', '#F4F3F0'], 'Ramon'],
    ['gantry', 'Gantry', 'Simulation', '2026-10-02', '512 KB', ['simulation', 'control'], 'A crane with real cable sway, built to teach PID tuning by feel.', ['#3A3A3A', '#F2C14E', '#D7D3CC', '#EEECE8'], 'Manuel'],
    ['kettle', 'Kettle', 'Tool', '2026-10-04', '96 KB', ['tools'], 'A recipe card that recalculates for altitude, pot size and how many people turn up.', ['#7A3E22', '#E0A26B', '#F6E6D4', '#FFFFFF'], 'Ramon'],
    ['tessellate', 'Tessellate', 'Toy', '2026-10-06', '204 KB', ['graphics', 'math'], 'Wallpaper groups as a toy: pick one of the seventeen and paint a single tile.', ['#2340D8', '#CEE5FF', '#F4F3F0', '#FFFFFF'], 'Manuel'],
    ['hum-studio', 'Hum Studio', 'Studio', '2026-10-08', '1.1 MB', ['audio', 'studio'], 'Hum a melody, edit it as a drawing, and play it back as a string quartet.', ['#4B2E5A', '#C9A3D9', '#F1E9F4', '#FFFFFF'], 'Ramon'],
    ['paper-moon', 'Paper Moon IDE', 'Workbench', '2026-10-10', '740 KB', ['simulation', 'workbench'], 'An editor for small orbital mechanics programs, with each trajectory drawn beside its line.', ['#141416', '#5A6B8C', '#C8D3E6', '#EEECE8'], 'Manuel'],
    ['night-ledger', 'Night Ledger', 'Workbench', '2026-10-12', '655 KB', ['agents', 'workbench'], 'A double-entry ledger an agent keeps overnight, with every entry explained in the margin.', ['#1F2A2E', '#6F8F8A', '#E2E8E4', '#F4F3F0'], 'Manuel'],
    ['quarry', 'Quarry', 'Search', '2026-10-14', '820 KB', ['agents', 'search'], 'Search a corpus by shape instead of words: sketch a curve, get the paragraphs that move like it.', ['#5B4B3A', '#B9A58A', '#EFE8DD', '#FFFFFF'], 'Ramon'],
    ['fresnel-bench', 'Fresnel Bench', 'Workbench', '2026-10-17', '1.3 MB', ['workbench', 'graphics'], 'Lenses, prisms and a light source on a bench. Drag a lens and the caustics follow.', ['#0F1720', '#F2C14E', '#F78154', '#EEECE8'], 'Manuel'],
    ['orbits', 'Orbits', 'Simulation', '2026-10-19', '41 KB', ['simulation', 'toy'], 'Bodies in orbit around one sun. Change the count and the speed.', ['#141416', '#2340D8', '#E9E6DF', '#F4F3F0'], 'Ramon', '/play/orbits'],
    ['loom-tide', 'Loom Tide', 'Simulation', '2026-10-21', '412 KB', ['simulation', 'data'], 'A tide table you can weave: each thread is a harbour, each knot a high water.', ['#1D3A5F', '#5AA0C8', '#E8F1F5', '#FFFFFF'], 'Ramon'],
    ['type-specimen', 'Type Specimen', 'Tool', '2026-10-23', '38 KB', ['tools', 'type'], 'The lab’s typeface at every size the site uses, with your own line of text.', ['#2F2D2A', '#C6C3BD', '#F4F3F0', '#FFFFFF'], 'Ramon', '/play/type'],
    ['pomodoro', 'Pomodoro', 'Tool', '2026-10-25', '22 KB', ['tools', 'toy'], 'Twenty-five minutes, four times, then a long break.', ['#B5603F', '#F0C9B5', '#F4F3F0', '#FFFFFF'], 'Manuel', '/play/pomodoro'],
    ['slop-computer', 'slop.computer', 'Workbench', '2026-10-28', '3.4 MB', ['agents', 'workbench'], 'The workshop behind the lab: artifacts, versions and routes, with agents that push and people who comment.', ['#1A1A1A', '#E2001A', '#EDEDED', '#FFFFFF'], 'Manuel and Ramon'],
  ];
  const expFiles = upto => {
    const f = {};
    EXPERIMENTS.slice(0, upto).forEach((e, i) => {
      const [slug, title, kind, date, size, tags, summary, colors, by, href] = e;
      f[`experiments/${slug}.json`] = JSON.stringify({ no: i + 1, title, kind, date, size, tags, summary, colors, by, href: href || null }, null, 2) + '\n';
    });
    return f;
  };

  const POSTS = {
    'contact-sheets': ['Contact sheets', '2026-10-15', ['workshop'], 'Why every artifact gets a filmstrip of its versions, and why that is enough review for two people.', 'Ramon', `When a photographer develops a roll, the first print is a contact sheet: every frame, small, side by side. You circle the good ones.

An agent that writes a page is a roll of film. It will push six versions before lunch. We do not need a review process for that, we need a contact sheet.

So every artifact here keeps every version it has ever had, and the Watch page shows them in a strip. Click one to look at it. Click on the page to say what is wrong. The agent reads that and pushes the next frame.

- Nothing is ever overwritten.
- A route decides which frame the public sees.
- Rolling back is pointing the route at an older frame.`],
    'tokens-as-data': ['Tokens are data too', '2026-10-17', ['design', 'data'], 'Colours and type as a data artifact that every page reads, so one change restyles the site.', 'Ramon', `The colours of this site are not in any page. They live in one small file, **tokens.json**, which is an artifact like the pages are.

Every page that declares it reads the tokens gets them as CSS variables. Change the sky blue in one place and every Support button on the site changes with it, in every version of every page that follows the tokens.

This is the same shape as a design system in claude.ai and in Shop Next, so the tokens can travel between them.`],
    'routes-not-templates': ['Routes, not templates', '2026-10-26', ['workshop', 'routing'], 'The site’s URLs used to be written into the server. Now a table says which artifact answers at which path.', 'Manuel', `Until now, every URL of the lab lived in the server’s code: one handler for the front page, one for an experiment, one for the journal. Changing what /pricing shows meant a deploy.

Now there is a table. Each row says: at this path, serve this artifact, at this version or following its main line, with this data. **/journal/:slug** is one row: one page, every post.

The table has a history, so any change can be undone by pointing back.`],
    'comments-as-prompts': ['Comments are prompts', '2026-10-22', ['agents', 'workshop'], 'The fastest way to tell an agent what is wrong is to point at it.', 'Manuel', `Writing a good prompt about a layout is hard. Pointing at the layout is easy.

A comment here remembers what you clicked: the version, the element and where on it. An agent waiting on **slop comments wait** gets all of that, changes the file, pushes a version and answers in the thread.

The thread stays open until one of us resolves it. That is the whole review process.`],
    'the-safe-page': ['The page that isn’t an artifact', '2026-10-24', ['workshop'], 'Everything on slop.computer is an artifact, except one page that can never break.', 'Manuel', `If every screen is an artifact, a bad push to the home screen could lock us out of the tool we would use to fix it.

So there is one page the server renders itself, at **/_/**. It can sign you in, list the routes, point any of them at an earlier version and revoke tokens. Nothing else. It is the part of the building with the fuse box.`],
    'orbits-notes': ['Notes on Orbits', '2026-10-19', ['simulation'], 'A small simulation, and the three versions it took to look right.', 'Ramon', `Orbits started as six dots on circles. The second version added trails, which made it look like a long exposure. The third took its colours from the site’s tokens, so it changes when the site does.

None of the physics is real. The orbits are ellipses with fixed speeds, which is what a person expects to see.`],
    'pages-and-data': ['Pages and data', '2026-10-28', ['workshop', 'data'], 'An artifact can be a page or a collection of records. A blog post is a file in a collection.', 'Manuel', `This post is a Markdown file. It lives in an artifact called **journal**, beside every other post, and it was published with one push.

The page you are reading it on did not change. It reads the journal and shows one post, chosen by the address. A new post needs no new page, and the same post can be exported as a static file next to its page.

- Pages are HTML, JS and CSS.
- Data is Markdown, JSON or CSV, with a type that says how to show it.
- A route binds the two.`],
    'slop-computer': ['slop.computer, a workshop for two', '2026-10-28', ['workshop', 'agents'], 'The tool behind this site: artifacts, versions and routes, made for two people and their agents.', 'Manuel', `slop.computer is where this site is made. It is the hosting we built for slop.boutique, cut down to two administrators, with every screen an artifact.

Our agents run in our own terminals. They push versions with a small command line tool, wait for our comments, and push again. We look at the versions in the browser, point at what is wrong, and decide which one each address shows.

There is no build step and no deploy. A push is a version; a route is a decision.`],
  };
  const postFile = id => {
    const [title, date, tags, summary, author, body] = POSTS[id];
    return `---\ntitle: ${title}\ndate: ${date}\ntags: [${tags.join(', ')}]\nauthor: ${author}\nsummary: ${summary}\n---\n${body}\n`;
  };
  const journalFiles = ids => Object.fromEntries(ids.map(id => [`posts/${id}.md`, postFile(id)]));
  const J12 = ['contact-sheets', 'tokens-as-data', 'routes-not-templates', 'orbits-notes', 'comments-as-prompts', 'the-safe-page'];
  const j12 = journalFiles(J12);
  j12['posts/routes-not-templates.md'] = j12['posts/routes-not-templates.md'].replace('date: 2026-10-26', 'date: 2026-10-25');

  const TOKENS = (sky, accent) => JSON.stringify({ name: 'Lab', colors: { wall: '#FFFFFF', plinth: '#F4F3F0', table: '#EEECE8', line: '#E7E5E1', faint: '#C6C3BD', muted: '#6F6C67', ink: '#2F2D2A', sky, accent, blue: accent }, type: { sans: '"ABC Areal", "Helvetica Neue", Helvetica, Arial, sans-serif', mono: '"ABC Areal Mono", ui-monospace, Menlo, monospace' }, radius: '3px' }, null, 2) + '\n';

  // ------------------------------------------------------------------ the seed
  window.SLOP_SEED = function (now) {
    const at = ago => now - ago;
    const users = [
      { id: 'manuel', name: 'Manuel', email: 'manuel@slop.computer', role: 'admin', initial: 'M', lastSeen: at(2 * MIN), created: at(30 * DAY) },
      { id: 'ramon', name: 'Ramon', email: 'ramon@slop.computer', role: 'admin', initial: 'R', lastSeen: at(14 * MIN), created: at(30 * DAY) },
      { id: 'sasha', name: 'Sasha Ilić', email: 'sasha@example.com', role: 'pending', initial: 'S', lastSeen: at(2 * DAY), created: at(2 * DAY) },
    ];
    const projects = [
      { id: 'lab-site', name: 'Lab site', brief: 'The public site of the lab: experiments, journal, support. Same look as slop.boutique. Pages read the experiments and the journal as data, and the colours from lab-tokens.' },
      { id: 'play', name: 'Play', brief: 'Small experiments that run in the page. Keep each one under 50 KB.' },
      { id: 'workshop', name: 'Workshop', brief: 'slop.computer’s own screens. Shells run on the main origin with the API.' },
    ];
    const artifacts = {};
    // V: [message, by, via, agoMs, opts?]
    const def = (id, title, kind, project, extra, versions) => {
      artifacts[id] = Object.assign({ id, title, kind, project, trust: kind === 'page' ? 'app' : null, created: versions[0].at, refs: {} }, extra);
      artifacts[id].versions = versions.map((v, i) => Object.assign({ n: i + 1 }, v));
      artifacts[id].refs.main = artifacts[id].versions.length;
    };
    const V = (message, by, via, ago, f, manifest, session) => ({ message, by, via, at: at(ago), files: f, manifest: manifest || {}, session: session || null });
    const LAB = (reads) => ({ reads: reads || {}, tokens: 'lab-tokens' });

    // front page
    const FP = LAB({ experiments: 'experiments', posts: 'journal' });
    def('front-page', 'Front page', 'page', 'lab-site', {}, [
      V('First front page: the list of experiments', 'manuel', 'claude', 9 * DAY, files(frontPage({ headline: 'A lab for computation and intelligence as material and medium.' })), FP),
      V('Search, tags and sort above the list', 'manuel', 'claude', 6 * DAY, files(frontPage({ headline: 'A lab for computation and intelligence as material and medium.', controls: true })), FP),
      V('Latest three journal posts under the list', 'ramon', 'claude', 3 * DAY, files(frontPage({ headline: 'A lab for computation and intelligence as material and medium.', controls: true, journal: true })), FP),
      V('Support callout at the bottom', 'ramon', 'cli', 20 * HOUR, files(frontPage({ headline: 'A lab for computation and intelligence as material and medium.', controls: true, journal: true, callout: true })), FP),
    ]);
    def('app-page', 'Experiment page', 'page', 'lab-site', {}, [
      V('One page for every experiment, by slug', 'manuel', 'claude', 8 * DAY, files(appPage({})), LAB({ experiments: 'experiments' })),
      V('Animated cover and “more like this”', 'ramon', 'claude', 2 * DAY, files(appPage({ animate: true, more: true })), LAB({ experiments: 'experiments' })),
    ]);
    const PR = (o) => pricing(Object.assign({ headline: 'Support the lab.', lede: 'Reading is free. Supporters run the experiments and keep the lab going.', gap: 48, emph: 'none' }, o));
    def('pricing', 'Pricing', 'page', 'lab-site', {}, [
      V('First take: three tiers', 'manuel', 'claude', 5 * DAY, files(PR({})), LAB()),
      V('Copy from Ramon’s brief', 'manuel', 'claude', 4 * DAY, files(PR({ lede: 'Reading about the lab is free and stays free. Supporters run every experiment in the browser and pay for the models behind them.' })), LAB()),
      V('Bigger prices, no shadows', 'ramon', 'cli', 3 * DAY + 4 * HOUR, files(PR({ lede: 'Reading about the lab is free and stays free. Supporters run every experiment in the browser and pay for the models behind them.', big: true })), LAB()),
      V('Middle tier first on phones, with a badge', 'manuel', 'claude', 2 * DAY + 3 * HOUR, files(PR({ lede: 'Reading about the lab is free and stays free. Supporters run every experiment in the browser and pay for the models behind them.', big: true, phoneFirst: true, badge: true })), LAB()),
      V('Monthly and yearly switch', 'manuel', 'claude', 2 * DAY, files(PR({ lede: 'Reading about the lab is free and stays free. Supporters run every experiment in the browser and pay for the models behind them.', big: true, phoneFirst: true, badge: true, toggle: true })), LAB()),
      V('Three questions under the tiers', 'ramon', 'claude', 5 * HOUR, files(PR({ lede: 'Reading about the lab is free and stays free. Supporters run every experiment in the browser and pay for the models behind them.', big: true, phoneFirst: true, badge: true, toggle: true, faq: true })), LAB()),
      V('Tiers: gap 48 → 24px, middle tier inverted', 'manuel', 'claude', 2 * MIN, files(PR({ lede: 'Reading about the lab is free and stays free. Supporters run every experiment in the browser and pay for the models behind them.', big: true, phoneFirst: true, badge: true, toggle: true, faq: true, gap: 24, emph: 'invert' })), LAB(), 'sess-manuel-1028'),
    ]);
    const AB = LAB({ experiments: 'experiments', posts: 'journal' });
    def('about', 'About', 'page', 'lab-site', {}, [
      V('About us, two lines', 'ramon', 'cli', 9 * DAY, files(about({})), AB),
      V('Numbers: experiments and posts, read from the data', 'manuel', 'claude', 4 * DAY, files(about({ stats: true })), AB),
      V('How we work', 'ramon', 'claude', 1 * DAY, files(about({ stats: true, how: true })), AB),
    ]);
    const JR = LAB({ posts: 'journal' });
    def('journal-index', 'Journal', 'page', 'lab-site', {}, [
      V('Journal as a plain list', 'manuel', 'claude', 7 * DAY, files(journalIndex({})), JR),
      V('Grouped by month', 'manuel', 'claude', 6 * DAY, files(journalIndex({ group: true })), JR),
      V('Summaries under the titles', 'ramon', 'claude', 5 * DAY, files(journalIndex({ group: true, summaries: true })), JR),
      V('Tags', 'ramon', 'claude', 3 * DAY, files(journalIndex({ group: true, summaries: true, tags: true })), JR),
      V('Covers for the three newest', 'manuel', 'claude', 1 * DAY, files(journalIndex({ group: true, summaries: true, tags: true, covers: true, time: true })), JR),
      V('Dates in mono', 'manuel', 'claude', 40 * MIN, files(journalIndex({ group: true, summaries: true, tags: true, covers: true, time: true, mono: true })), JR, 'sess-manuel-1028'),
    ]);
    def('journal-post', 'Journal post', 'page', 'lab-site', {}, [
      V('One page for every post', 'manuel', 'claude', 7 * DAY, files(journalPost({})), JR),
      V('Tags and reading time', 'ramon', 'claude', 4 * DAY, files(journalPost({ tags: true, time: true })), JR),
      V('Earlier and later links', 'manuel', 'claude', 1 * DAY, files(journalPost({ tags: true, time: true, nav: true, mono: true })), JR),
    ]);
    def('not-found', 'Not found', 'page', 'lab-site', {}, [V('A 404 that says why', 'ramon', 'cli', 6 * DAY, files(notFound()), LAB())]);
    def('press-kit', 'Press kit', 'page', 'lab-site', {}, [V('Press page, not routed yet', 'ramon', 'claude', 3 * HOUR, files(pressKit()), LAB())]);
    def('orbits', 'Orbits', 'page', 'play', {}, [
      V('Six bodies on circles', 'ramon', 'claude', 10 * DAY, files(orbits({ bodies: 6 })), LAB()),
      V('Trails, on a dark ground', 'ramon', 'claude', 9 * DAY, files(orbits({ bodies: 8, trails: true, trailsToggle: true, dark: true })), LAB()),
      V('Colours from the site’s tokens', 'ramon', 'claude', 4 * DAY, files(orbits({ bodies: 9, trailsToggle: true })), LAB()),
    ]);
    def('type-specimen', 'Type specimen', 'page', 'play', {}, [
      V('Three sizes', 'ramon', 'cli', 5 * DAY, files(typeSpecimen({})), LAB()),
      V('Waterfall of every size, mono switch', 'ramon', 'claude', 3 * DAY, files(typeSpecimen({ waterfall: true, mono: true })), LAB()),
    ]);
    def('pomodoro', 'Pomodoro', 'page', 'play', {}, [
      V('A 25 minute timer', 'manuel', 'claude', 3 * DAY, files(pomodoro({ minutes: 25 })), LAB()),
      V('Sessions and a length slider', 'ramon', 'claude', 2 * DAY, files(pomodoro({ minutes: 25, sessions: true })), LAB()),
    ]);
    // shells
    const SH = [['watch', 'Watch', 'Artifacts, versions, comments and the route each one serves.', 9], ['routes', 'Routes', 'Which artifact answers at which path, with history.', 4], ['artifacts', 'Artifacts', 'Every page and data artifact, with pushing.', 3], ['site', 'Site', 'Any route, served as a visitor sees it.', 2], ['admin', 'Admin', 'People, tokens and the audit log.', 2]];
    SH.forEach(([id, name, about, count]) => {
      def(id, name, 'page', 'workshop', { trust: 'shell' }, Array.from({ length: count }, (_, i) => V(i === 0 ? `First ${name} shell` : `${name}: revision ${i + 1}`, i % 2 ? 'ramon' : 'manuel', 'claude', (count - i) * DAY + 3 * HOUR, shell(name, about), { reads: {} })));
    });
    // data
    def('journal', 'Journal posts', 'data', 'lab-site', { type: 'post', viewer: 'journal-post' }, [
      V('Six posts from the old site', 'manuel', 'cli', 3 * DAY, j12, { type: 'post' }),
      V('Fix the date on “Routes, not templates”', 'manuel', 'browser', 1 * DAY, Object.assign({}, j12, { 'posts/routes-not-templates.md': postFile('routes-not-templates') }), { type: 'post' }),
      V('Two posts about slop.computer', 'manuel', 'cli', 25 * MIN, Object.assign({}, journalFiles(J12), journalFiles(['pages-and-data', 'slop-computer'])), { type: 'post' }, 'sess-manuel-1028'),
    ]);
    def('experiments', 'Experiments', 'data', 'lab-site', { type: 'records', viewer: 'app-page' }, [
      V('Thirteen experiments', 'ramon', 'cli', 2 * DAY, expFiles(13), { type: 'records' }),
      V('Add slop.computer itself', 'ramon', 'browser', 3 * HOUR, expFiles(14), { type: 'records' }),
    ]);
    def('lab-tokens', 'Lab tokens', 'data', 'lab-site', { type: 'tokens', viewer: 'front-page' }, [
      V('Colours and type from slop.boutique', 'ramon', 'cli', 9 * DAY, { 'tokens.json': TOKENS('#D8E7FB', '#2340D8') }, { type: 'tokens' }),
      V('Sky a little stronger', 'ramon', 'browser', 2 * DAY, { 'tokens.json': TOKENS('#CEE5FF', '#2340D8') }, { type: 'tokens' }),
    ]);

    // routes: host → rows. page follows main unless pinned (version set)
    const R = (host, path, page, o) => Object.assign({ host, path, page, version: null, bindings: {}, record: null, access: 'public', changedBy: 'manuel', changedAt: at(2 * DAY) }, o || {});
    const routes = [
      R('slop.computer', '/', 'watch', { access: 'admins', changedAt: at(9 * DAY) }),
      R('slop.computer', '/watch/*', 'watch', { access: 'admins', changedAt: at(9 * DAY) }),
      R('slop.computer', '/routes', 'routes', { access: 'admins', changedAt: at(4 * DAY) }),
      R('slop.computer', '/artifacts', 'artifacts', { access: 'admins', changedAt: at(3 * DAY), changedBy: 'ramon' }),
      R('slop.computer', '/site', 'site', { access: 'admins', changedAt: at(2 * DAY) }),
      R('slop.computer', '/admin', 'admin', { access: 'admins', changedAt: at(2 * DAY) }),
      R('slop.boutique', '/', 'front-page', { changedAt: at(9 * DAY) }),
      R('slop.boutique', '/apps/:slug', 'app-page', { record: 'experiments/{slug}.json', changedAt: at(8 * DAY) }),
      R('slop.boutique', '/pricing', 'pricing', { version: 5, changedAt: at(2 * DAY) }),
      R('slop.boutique', '/about', 'about', { changedBy: 'ramon', changedAt: at(9 * DAY) }),
      R('slop.boutique', '/journal', 'journal-index', { changedAt: at(7 * DAY) }),
      R('slop.boutique', '/journal/:slug', 'journal-post', { record: 'posts/{slug}.md', changedBy: 'ramon', changedAt: at(7 * DAY) }),
      R('slop.boutique', '/play/orbits', 'orbits', { changedBy: 'ramon', changedAt: at(10 * DAY) }),
      R('slop.boutique', '/play/type', 'type-specimen', { changedBy: 'ramon', changedAt: at(5 * DAY) }),
      R('slop.boutique', '/play/pomodoro', 'pomodoro', { changedAt: at(3 * DAY) }),
      R('slop.boutique', '*', 'not-found', { changedBy: 'ramon', changedAt: at(6 * DAY) }),
    ];
    const routeLog = [
      { host: 'slop.boutique', path: '/pricing', at: at(4 * DAY), by: 'manuel', to: { version: 2 }, note: 'created, pinned v2' },
      { host: 'slop.boutique', path: '/pricing', at: at(3 * DAY), by: 'ramon', to: { version: 3 }, note: 'pinned v3' },
      { host: 'slop.boutique', path: '/pricing', at: at(2 * DAY), by: 'manuel', to: { version: 5 }, note: 'pinned v5' },
      { host: 'slop.boutique', path: '/journal', at: at(7 * DAY), by: 'manuel', to: { version: null }, note: 'created, follows main' },
      { host: 'slop.boutique', path: '/journal/:slug', at: at(7 * DAY), by: 'ramon', to: { version: null }, note: 'created, follows main' },
      { host: 'slop.boutique', path: '/', at: at(9 * DAY), by: 'manuel', to: { version: null }, note: 'created, follows main' },
    ];

    // comments: anchors are a selector plus where on the element (fx, fy); data comments anchor on a record
    const threads = [
      { id: 'th_8k2', artifact: 'pricing', version: 6, anchor: { selector: 'section.tiers', fx: 0.5, fy: 0.12, text: 'Reader Free Read about every experiment…' }, by: 'ramon', at: at(3 * HOUR), resolved: false,
        comments: [{ by: 'ramon', at: at(3 * HOUR), text: 'Too much air between the tiers. The middle one should win.' }, { by: 'manuel', agent: true, at: at(2 * MIN), version: 7, text: 'Done in v7: gap 48px → 24px on section.tiers, and the middle tier is inverted. Point /pricing at it when it looks right.' }] },
      { id: 'th_9q1', artifact: 'pricing', version: 7, anchor: { selector: '#period', fx: 0.8, fy: 0.5, text: 'Monthly Yearly, two months free' }, by: 'manuel', at: at(1 * MIN), resolved: false,
        comments: [{ by: 'manuel', at: at(1 * MIN), text: 'Yearly should say how much it saves, in euros.' }] },
      { id: 'th_3d7', artifact: 'journal-index', version: 5, anchor: { selector: 'p.sb-kicker', fx: 0.1, fy: 0.5, text: '28 October 2026 · 2 min read' }, by: 'ramon', at: at(2 * HOUR), resolved: true, resolvedBy: 'ramon', resolvedAt: at(30 * MIN),
        comments: [{ by: 'ramon', at: at(2 * HOUR), text: 'Dates in mono, please.' }, { by: 'manuel', agent: true, at: at(40 * MIN), version: 6, text: 'Done in v6: dates are in the mono face and written as 2026-10-28.' }] },
      { id: 'th_5mm', artifact: 'front-page', version: 4, anchor: { selector: 'section.support-callout', fx: 0.3, fy: 0.3, text: 'Keep the lab running.' }, by: 'manuel', at: at(18 * HOUR), resolved: false,
        comments: [{ by: 'manuel', at: at(18 * HOUR), text: 'The callout is too loud on phones.' }, { by: 'ramon', at: at(16 * HOUR), text: 'Agreed. Let’s try it smaller next week.' }] },
      { id: 'th_2rt', artifact: 'journal', version: 1, anchor: { record: 'posts/routes-not-templates.md', field: 'date' }, by: 'ramon', at: at(30 * HOUR), resolved: true, resolvedBy: 'manuel', resolvedAt: at(1 * DAY),
        comments: [{ by: 'ramon', at: at(30 * HOUR), text: 'This went out on the 26th, not the 25th.' }, { by: 'manuel', at: at(1 * DAY), version: 2, text: 'Fixed in v2.' }] },
      { id: 'th_7or', artifact: 'orbits', version: 3, anchor: { selector: 'div.runner-surface', fx: 0.5, fy: 0.5, text: '' }, by: 'manuel', at: at(3 * DAY), resolved: false,
        comments: [{ by: 'manuel', at: at(3 * DAY), text: 'I miss the trails from v2. Can they be on by default?' }] },
    ];

    const tokens = [
      { id: 'tok_m1', owner: 'manuel', name: 'manuel · laptop', scopes: ['read', 'write', 'admin'], created: at(20 * DAY), lastUsed: at(2 * MIN), expires: at(-70 * DAY) },
      { id: 'tok_m2', owner: 'manuel', name: 'claude code agent', scopes: ['read', 'write'], created: at(12 * DAY), lastUsed: at(2 * MIN), expires: at(-78 * DAY) },
      { id: 'tok_r1', owner: 'ramon', name: 'ramon · studio mac', scopes: ['read', 'write'], created: at(18 * DAY), lastUsed: at(3 * HOUR), expires: at(-72 * DAY) },
      { id: 'tok_r2', owner: 'ramon', name: 'claude code agent', scopes: ['read', 'write'], created: at(9 * DAY), lastUsed: at(5 * HOUR), expires: at(-81 * DAY) },
      { id: 'tok_ci', owner: 'manuel', name: 'static export in CI', scopes: ['read'], created: at(40 * DAY), lastUsed: at(11 * DAY), expires: at(10 * DAY) },
    ];

    const consoleLines = [
      { at: at(3 * HOUR), who: "Claude Code (Manuel's)", kind: 'cmd', text: 'slop comments wait --project lab-site' },
      { at: at(5 * MIN), who: "Claude Code (Manuel's)", kind: 'out', text: '{"thread":"th_8k2","artifact":"pricing","version":6,"by":"Ramon","text":"Too much air between the tiers. The middle one should win.","anchor":{"selector":"section.tiers"}}' },
      { at: at(4 * MIN), who: "Claude Code (Manuel's)", kind: 'note', text: 'reading pricing v6 · index.html 9 KB, boutique.css 29 KB' },
      { at: at(2 * MIN), who: "Claude Code (Manuel's)", kind: 'cmd', text: 'slop push ./pricing -a pricing -m "Tiers: gap 48 → 24px, middle tier inverted" --reply th_8k2' },
      { at: at(2 * MIN), who: "Claude Code (Manuel's)", kind: 'out', text: 'pushed pricing v7 · 1 file changed · replied on th_8k2' },
      { at: at(2 * MIN), who: "Claude Code (Manuel's)", kind: 'cmd', text: 'slop comments wait --project lab-site' },
      { at: at(5 * HOUR), who: "Claude Code (Ramon's)", kind: 'cmd', text: 'slop comments wait --project play' },
    ];

    const audit = [
      { at: at(2 * MIN), actor: 'manuel', via: 'claude code agent', action: 'version.push', subject: 'pricing v7' },
      { at: at(25 * MIN), actor: 'manuel', via: 'manuel · laptop', action: 'version.push', subject: 'journal v3' },
      { at: at(40 * MIN), actor: 'manuel', via: 'claude code agent', action: 'version.push', subject: 'journal-index v6' },
      { at: at(3 * HOUR), actor: 'ramon', via: 'browser', action: 'version.push', subject: 'experiments v2' },
      { at: at(2 * DAY), actor: 'manuel', via: 'browser', action: 'route.set', subject: 'slop.boutique/pricing → v5' },
      { at: at(2 * DAY), actor: 'sasha', via: 'browser', action: 'user.signin', subject: 'first sign-in, pending' },
      { at: at(11 * DAY), actor: 'manuel', via: 'static export in CI', action: 'export.static', subject: 'slop.boutique, 31 pages' },
    ];

    return { users, projects, artifacts, routes, routeLog, threads, tokens, console: consoleLines, audit,
      agents: [
        { id: 'agent-manuel', owner: 'manuel', name: "Claude Code (Manuel's)", project: 'lab-site', session: 'sess-manuel-1028', since: at(3 * HOUR) },
        { id: 'agent-ramon', owner: 'ramon', name: "Claude Code (Ramon's)", project: 'play', session: 'sess-ramon-1028', since: at(5 * HOUR) },
      ] };
  };
})();
