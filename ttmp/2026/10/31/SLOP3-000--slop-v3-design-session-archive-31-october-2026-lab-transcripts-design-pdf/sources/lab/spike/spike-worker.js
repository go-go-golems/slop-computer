import sqlite3InitModule from '../../vendor/sqlite-wasm/src/bin/sqlite3.mjs';
import { getQuickJS } from '@tootallnate/quickjs-emscripten';

const out = [];
const log = (...a) => out.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));

(async () => {
  try {
    const sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
    const { capi, wasm } = sqlite3;
    log('sqlite', capi.sqlite3_libversion());
    const db = new sqlite3.oo1.DB(':memory:', 'c');
    db.exec('CREATE TABLE _docs(path TEXT PRIMARY KEY, body TEXT); CREATE TABLE tasks(id INTEGER PRIMARY KEY, title TEXT, owner TEXT); CREATE VIEW my_tasks AS SELECT * FROM tasks WHERE owner = slop_me();');
    db.createFunction({ name: 'slop_me', xFunc: () => 'u1', deterministic: false });
    const auth = [];
    let denyDocs = true;
    const rc = capi.sqlite3_set_authorizer(db.pointer, (pV, code, a, b, c, d) => {
      const s = (p) => (typeof p === 'string' ? p : p ? wasm.cstrToJs(p) : null);
      const row = [code, s(a), s(b), s(c), s(d)];
      auth.push(row);
      if (denyDocs && code === capi.SQLITE_READ && row[1] === '_docs') return capi.SQLITE_DENY;
      return 0;
    }, 0);
    log('set_authorizer rc', rc);
    const hooks = [];
    capi.sqlite3_update_hook(db.pointer, (pV, op, dbn, tbl, rowid) => { hooks.push([op, typeof tbl === 'number' ? wasm.cstrToJs(tbl) : tbl, String(rowid)]); }, 0);
    db.exec("INSERT INTO tasks(title, owner) VALUES ('a','u1'),('b','u2')");
    log('hooks', hooks);
    const rows = db.selectObjects('SELECT * FROM my_tasks');
    log('rows via view', rows);
    log('auth sample', auth.slice(-6));
    try { db.selectObjects('SELECT * FROM _docs'); log('docs read allowed?!'); } catch (e) { log('docs denied ok:', String(e.message).slice(0, 80)); }
    let n = 0;
    capi.sqlite3_progress_handler(db.pointer, 1000, () => (++n > 50 ? 1 : 0), 0);
    try { db.exec('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) SELECT count(*) FROM c'); } catch (e) { log('progress interrupted ok:', String(e.message).slice(0, 60)); }
    capi.sqlite3_progress_handler(db.pointer, 0, 0, 0);
    const bytes = capi.sqlite3_js_db_export(db.pointer);
    log('export bytes', bytes.length);
    const db2 = new sqlite3.oo1.DB();
    const p = wasm.allocFromTypedArray(bytes);
    const drc = capi.sqlite3_deserialize(db2.pointer, 'main', p, bytes.length, bytes.length, capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE);
    log('deserialize rc', drc, db2.selectValue('SELECT count(*) FROM tasks'));
    db.exec('BEGIN'); try { db.exec("VACUUM INTO 'x.db'"); log('vacuum in tx?!'); } catch (e) { log('vacuum in tx refused ok'); } db.exec('ROLLBACK');

    const QuickJS = await getQuickJS();
    const rt = QuickJS.newRuntime();
    rt.setMemoryLimit(32 * 1024 * 1024);
    rt.setMaxStackSize(512 * 1024);
    let deadline = 0;
    rt.setInterruptHandler(() => Date.now() > deadline);
    const vm = rt.newContext();
    const sqlFn = vm.newFunction('sqlAll', (qh) => {
      const q = vm.getString(qh);
      denyDocs = false;
      const r = db.selectObjects(q);
      return vm.newString(JSON.stringify(r));
    });
    vm.setProp(vm.global, 'sqlAll', sqlFn); sqlFn.dispose();
    let pending;
    const asyncFn = vm.newFunction('later', () => { const d = vm.newPromise(); pending = d; return d.handle; });
    vm.setProp(vm.global, 'later', asyncFn); asyncFn.dispose();
    deadline = Date.now() + 250;
    const r1 = vm.evalCode(`
      globalThis.handlers = {};
      function defineActor(spec) { globalThis.handlers = spec; }
      defineActor({ actions: {
        count() { return JSON.parse(sqlAll('SELECT count(*) n FROM tasks'))[0].n; },
        async twoTurns() { const a = JSON.parse(sqlAll('SELECT title FROM tasks')); const b = await later(); return a.length + ':' + b; },
        spin() { for(;;){} },
      }});
      handlers.actions.count();
    `);
    log('quickjs count', r1.error ? vm.dump(r1.error) : vm.dump(r1.value)); (r1.error || r1.value).dispose();
    const r2 = vm.evalCode('globalThis.__res = null; handlers.actions.twoTurns().then(v => { globalThis.__res = v; });');
    (r2.error || r2.value).dispose();
    rt.executePendingJobs();
    const before = vm.dump(vm.getProp(vm.global, '__res'));
    pending.resolve(vm.newString('done')); pending.dispose();
    rt.executePendingJobs();
    log('quickjs async before/after', before, vm.dump(vm.getProp(vm.global, '__res')));
    deadline = Date.now() + 100;
    const r3 = vm.evalCode('handlers.actions.spin()');
    log('quickjs interrupt', r3.error ? vm.dump(r3.error) : 'no error?!'); (r3.error || r3.value).dispose();
    postMessage({ ok: true, out });
  } catch (e) {
    log('ERROR', String(e && e.stack || e));
    postMessage({ ok: false, out });
  }
})();
