(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const [db, user, room, slop] = await Promise.all(['db', 'user', 'room', 'slop'].map((n) => claude.use(n)));
  if (!slop) {
    $('msg').textContent = 'This page needs the slop runtime.';
    return;
  }

  // The visitor (with level and audience) comes from the slop namespace;
  // user.me() is the contract's profile shape and has no level here.
  const me = user ? await user.me() : null;
  const visitor = slop.visitor ? await slop.visitor() : null;
  const level = (visitor && visitor.level) || (me && me.level) || 'view';
  const canVote = ['interact', 'admin', 'owner'].includes(level);

  let options = [];
  let counts = {};
  let total = 0;
  let mine = null;

  const say = (text, bad) => {
    $('msg').textContent = text || '';
    $('msg').classList.toggle('bad', !!bad);
  };

  function render() {
    const max = Math.max(1, ...options.map((o) => counts[o.id] || 0));
    $('options').innerHTML = options.map((o) => {
      const n = counts[o.id] || 0;
      const width = Math.round((n / max) * 100);
      const selected = mine === o.id;
      return `<button type="button" class="option${selected ? ' mine' : ''}" data-option="${esc(o.id)}"
        aria-pressed="${selected}"${canVote ? '' : ' disabled'}>
        <span class="row"><span class="label">${esc(o.label)}${selected ? '<span class="tick">your vote</span>' : ''}</span><span class="n">${n}</span></span>
        <span class="bar" aria-hidden="true"><span style="width:${width}%"></span></span>
      </button>`;
    }).join('');
    $('total').textContent = `${total} vote${total === 1 ? '' : 's'}`;
    $('you').textContent = mine ? `You picked ${labelOf(mine)}.` : (canVote ? 'Pick one.' : 'Sign in to vote.');
  }

  function labelOf(id) {
    const o = options.find((x) => x.id === id);
    return o ? o.label : id;
  }

  function apply(s) {
    if (!s) return;
    if (Array.isArray(s.options)) options = s.options;
    if (s.counts) counts = s.counts;
    if (typeof s.total === 'number') total = s.total;
    if ('mine' in s) mine = s.mine;
    render();
  }

  try {
    apply(await slop.actions.state());
  } catch (err) {
    say(`${err.code || 'error'}: ${err.message}`, true);
  }

  $('options').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-option]');
    if (!b || !canVote) return;
    const option = b.dataset.option;
    $('options').querySelectorAll('button').forEach((x) => { x.disabled = true; });
    try {
      const s = await slop.actions.vote({ option });
      apply(s);
      say(`Counted: ${labelOf(option)}. Your latest vote is the one that counts.`);
    } catch (err) {
      say(`${err.code || 'error'}: ${err.message}`, true);
    } finally {
      render();
    }
  });

  // Live counts: the actor rewrites poll/tally on every vote, so every open
  // page gets the new numbers without asking.
  if (db) {
    db.doc('poll/tally').onSnapshot((s) => apply(s.data()), (e) => say(e.message, true));
  }

  // Presence: who has this page open right now. Never stored.
  if (room) {
    // onPeers reports a change object, not the array itself.
    room.onPeers((change) => {
      const n = change && change.peers ? change.peers.length : 0;
      $('presence').textContent = n <= 1 ? 'just you here right now' : `${n} people here right now`;
    });
  } else {
    $('presence').hidden = true;
  }
})();
