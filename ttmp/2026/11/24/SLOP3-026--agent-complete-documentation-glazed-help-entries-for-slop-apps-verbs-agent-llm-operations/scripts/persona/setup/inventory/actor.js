// The workshop's inventory, in the items table (sql/001_items.sql).
const sql = use('sql');
defineActor({
  actions: {
    list: { requires: 'view', run() { return sql.all('SELECT id, name, qty FROM items ORDER BY name'); } },
    add: { requires: 'admin', run(ctx, { name, qty }) {
      return sql.run('INSERT INTO items (name, qty) VALUES (?, ?)', String(name), Number(qty) || 0);
    } },
    set: { requires: 'interact', run(ctx, { id, qty }) {
      return sql.run('UPDATE items SET qty = ? WHERE id = ?', Number(qty) || 0, Number(id));
    } },
  },
});
