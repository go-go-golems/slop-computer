// actor.js: the poll's server half. Votes are rows in SQL (one per person);
// the actor also keeps a tally document that every open page subscribes to,
// so counts move without anyone reloading.

const sql = use('sql'), db = use('db'), room = use('room');

const OPTIONS = [
  { id: 'guestbook', label: 'Guestbook' },
  { id: 'recipe-box', label: 'Recipe box' },
  { id: 'habit-tracker', label: 'Habit tracker' },
  { id: 'book-club', label: 'Book club' },
];
const LABELS = new Map(OPTIONS.map((o) => [o.id, o.label]));

function counts() {
  const rows = sql.all('SELECT option, count(*) AS n FROM votes GROUP BY option');
  const out = {};
  for (const o of OPTIONS) out[o.id] = 0;
  for (const r of rows) if (r.option in out) out[r.option] = Number(r.n);
  return out;
}

function tally() {
  const c = counts();
  return {
    counts: c,
    total: OPTIONS.reduce((sum, o) => sum + c[o.id], 0),
    options: OPTIONS,
  };
}

defineActor({
  // Runs once per version, inside activation. Repair the live document if the
  // store is new or the previous activation left it stale.
  setup(ctx) {
    db.doc('poll/tally').set({ ...tally(), asOfRev: ctx.rev, at: ctx.now });
  },

  smoke(ctx) {
    sql.one('SELECT count(*) AS n FROM votes');
  },

  actions: {
    // The page's first read: the choices, the counts, and this person's vote.
    state(ctx) {
      ctx.need('view');
      const mine = sql.one('SELECT option FROM votes WHERE voter = ?', ctx.visitor.id);
      return { ...tally(), mine: mine ? mine.option : null };
    },

    // The only way in. The server checks the option and takes the voter's id
    // from the principal, never from the page. A later vote replaces the old.
    vote(ctx, args) {
      ctx.need('interact');
      const option = String((args && args.option) || '');
      if (!LABELS.has(option)) ctx.fail('invalid_argument', 'no such option: ' + option);

      sql.run(
        `INSERT INTO votes(voter, option, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(voter) DO UPDATE SET option = excluded.option, updated_at = excluded.updated_at`,
        ctx.visitor.id, option, ctx.now
      );

      room.emit('vote', { option });
      return { ...tally(), mine: option };
    },
  },

  // Writes the tally document in the same turn as the vote that caused it.
  // Pages see the new counts through their subscription to poll/tally.
  on: {
    'table:votes'(ctx, commit) {
      db.doc('poll/tally').set({ ...tally(), asOfRev: commit.rev, at: ctx.now });
    },
  },
});
