// The quiz's server half: this week's questions, and scoring an attempt.
// Built by a colleague in the bench; students take the quiz every week.
const sql = use('sql');

function thisWeek() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return d.getFullYear() + '-W' + String(week).padStart(2, '0');
}

defineActor({
  actions: {
    questions: {
      requires: 'view',
      run(ctx) {
        // the latest week that has questions
        const w = sql.one('SELECT max(week) AS week FROM questions');
        return sql.all('SELECT id, text, choices FROM questions WHERE week = ? ORDER BY id', w.week)
          .map((q) => ({ id: q.id, text: q.text, choices: JSON.parse(q.choices) }));
      },
    },
    submit: {
      requires: 'interact',
      run(ctx, { answers }) {
        const w = sql.one('SELECT max(week) AS week FROM questions').week;
        const qs = sql.all('SELECT id, answer FROM questions WHERE week = ?', w);
        let score = 0;
        for (const q of qs) if (answers && answers[q.id] === q.answer) score++;
        sql.run('INSERT INTO attempts (week, student, score, at) VALUES (?, ?, ?, ?)', w, ctx.visitor.name || 'student', score, Date.now());
        return { score, of: qs.length };
      },
    },
  },
});
