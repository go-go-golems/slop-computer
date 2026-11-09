'use strict';
// Experiment 3: collections (schema builder), queries, and which reads are
// tracked as dependency keys. Offline: PB.rt.db is null, level 'owner'.
// node exp3-db.js <apps/pinboard>
const { load, J } = require('./harness.js');
const { PB } = load(process.argv[2]);
const t = (name, fn) => { try { const v = fn(); console.log(name + ': ok ' + (typeof v === 'string' ? v : J(v))); } catch (e) { console.log(name + ': THROWS ' + e.constructor.name + ': ' + e.message); } };
const db = PB.db;

console.log('--- schema builder');
const before = PB.history.txs.length;
const sb = db.collection('recipes').field('title', 'text').required().field('serves', 'int', { min: 1 }).field('tags', 'text[]').field('added', 'time').auto().index('tags');
t('schema', () => sb.schema);
t('transactions recorded by one schema chain (coalesce collection:recipes)', () => [PB.history.txs.length - before, PB.history.txs.slice(before).map(x => x.ops.length)]);
t('schema builder name check', () => db.collection('bad name'));
t('required() before field()', () => db.collection('fresh').required());
t('migrate(2, s => s.rename(...))', () => { db.recipes.insert({ title: 'Soup', serves: 2 }); db.collection('recipes').migrate(2, s => s.rename('serves', 'servings')); return [db.recipes.schema().version, db.recipes.schema().fields.map(f => f.name), db.recipes.first()]; });
t('migrate(2) again is a no-op', () => { db.collection('recipes').migrate(2, s => { throw new Error('ran again'); }); return db.recipes.schema().version; });
t('required is not enforced on insert', () => { const id = db.recipes.insert({ servings: 3 }); return db.recipes.get(id); });

console.log('--- queries');
['Shakshuka', 'Apple pie', 'Borscht'].forEach((title, i) => db.recipes.insert({ title, servings: i + 1, tags: i ? ['dinner'] : ['eggs', 'dinner'], added: 1000 + i }));
t('all() default order is by added', () => db.recipes.all().map(r => r.title));
t('where + orderBy desc + limit', () => db.recipes.where(r => (r.tags || []).includes('dinner')).orderBy('servings', 'desc').limit(2).all().map(r => r.title));
t('orderBy(["title","asc"])', () => db.recipes.orderBy(['title', 'asc']).all().map(r => r.title));
t('orderBy dotted path "tags.0"', () => db.recipes.orderBy('tags.0').all().map(r => (r.tags || [])[0]));
t('distinct("tags")', () => db.recipes.distinct('tags'));
t('count(), first().title, get(id) of another coll', () => [db.recipes.count(), db.recipes.first().title, db.nope.get(db.recipes.first().id)]);
t('a throwing predicate drops the row', () => db.recipes.where(r => r.tags.includes('eggs')).count());
t('guide ch.06: where(c => l => …) (curried context predicate) filters nothing', () => db.recipes.where(c => l => false).count());
t('guide ch.04/11: orderBy(c => c.param("sort")) runs the lambda on records', () => db.recipes.orderBy(c => c.param('sort')).all().length);
t('queries are immutable', () => { const q = db.recipes.where(r => true); const q2 = q.limit(1); return [q.lim, q2.lim]; });
t('db.<unknown name> is an empty query', () => [db.nothing.count(), db.nothing.schema()]);
t('db.toYAML()', () => db.toYAML());
t('query toJSON', () => db.recipes.where(r => 1).orderBy('title').limit(3).toJSON());
t('guide ch.07: db.recipes.get(4).toClip()', () => db.recipes.get(db.recipes.first().id).toClip());
t('update with a function patch', () => { const id = db.recipes.first().id; db.recipes.update(id, r => ({ servings: (r.servings || 0) + 10 })); return db.recipes.get(id).servings; });
t('insert into a collection that does not exist makes it (fields from keys, type text)', () => { db.made.insert({ a: 1, b: 'x' }); return db.made.schema(); });

console.log('--- tracking (render-time dependency keys)');
const keys = new Set();
const ctx = { deps: keys };
const tracked = (fn) => { keys.clear(); PB.withCtx(ctx, fn); return [...keys]; };
t('query.all() tracks coll:<name>', () => tracked(() => db.recipes.all()));
t('query.count()/first()/distinct() track via all()', () => tracked(() => { db.recipes.count(); db.recipes.distinct('tags'); }));
t('query.get(id) tracks coll:<name>', () => tracked(() => db.recipes.get('x')));
t('db.collections() tracks "collections"', () => tracked(() => db.collections()));
t('db.record(id) tracks nothing', () => tracked(() => db.record(db.recipes.first().id)));
t('db.has(name) tracks nothing', () => tracked(() => db.has('recipes')));
t('query.schema() tracks nothing', () => tracked(() => db.recipes.schema()));
t('board.clips() tracks "clips"; selection() "selection"; log() "log"; get(id) nothing', () => tracked(() => { PB.boardAPI.clips(); PB.boardAPI.get('x'); PB.boardAPI.log(); }));
t('outside withCtx nothing is tracked (PB.track is null)', () => { keys.clear(); db.recipes.all(); return [...keys]; });

console.log('--- keys a change produces (core.keysFor)');
t('insert a record', () => { let k; const off = PB.on('mutation', (tx, ks) => { k = [...ks]; }); db.recipes.insert({ title: 'x' }); off(); return k; });
t('move a clip', () => { const id = PB.mutate(m => m.place({ kind: 'note', text: 'n' })); let k; const off = PB.on('mutation', (tx, ks) => { k = [...ks]; }); PB.mutate(m => m.move(id, { x: 1, y: 2 })); off(); return k; });
t('collection schema change', () => { let k; const off = PB.on('mutation', (tx, ks) => { k = [...ks]; }); db.collection('recipes').index('title'); off(); return k; });
t('PB.setState(id, {n})', () => { let k; const off = PB.on('change', (ks) => { k = [...ks]; }); const id = Object.keys(PB.S.clips)[0]; PB.setState(id, { n: 1 }); off(); return k; });
t('PB.setLocal(id, {q})', () => { let k; const off = PB.on('change', (ks) => { k = [...ks]; }); PB.setLocal('clip:x', { q: 'a' }); off(); return k; });
t('history: setState is not a transaction', () => { const n = PB.history.txs.length; PB.setState(Object.keys(PB.S.clips)[0], { n: 2 }); return PB.history.txs.length - n; });
