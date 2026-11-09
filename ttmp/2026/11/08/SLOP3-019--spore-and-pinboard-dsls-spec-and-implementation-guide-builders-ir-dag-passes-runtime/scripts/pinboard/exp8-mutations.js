'use strict';
// Experiment 8: the mutation recorder's return values (chaining as the
// Reference, the agent's instructions and guide ch.10 write it), mount
// without a context, and the board API's documented-but-missing members.
const { load, html, J } = require('./harness.js');
const { PB, El } = load(process.argv[2]);
PB.toast = () => {};
const t = (name, fn) => { try { const v = fn(); console.log(name + ': ok ' + (typeof v === 'string' ? v : J(v))); } catch (e) { console.log(name + ': THROWS ' + e.constructor.name + ': ' + e.message); } };
const id = PB.mutate(m => m.place({ kind: 'note', text: 'n', title: 'old' }));
t('m.move(...) returns', () => { let r; PB.mutate(m => { r = m.move(id, { x: 5, y: 6 }); }); return Object.keys(r); });
t('chained m.move(...).retitle(...) (Reference/agent instructions/guide ch.10)', () => PB.mutate(m => m.move(id, { x: 7, y: 8 }).retitle(id, 'new')));
t('…and the failed transaction rolled back', () => [PB.S.clips[id].x, PB.S.clips[id].title]);
t('m.insert returns the id; m.place the id; m.promote the record id', () => PB.mutate(m => [typeof m.insert('c', { a: 1 }), typeof m.place({ kind: 'note' })]));
t('PB.mutate(fn) returns fn\'s value', () => PB.mutate(m => 42));
t('mount(el) without a context, static builder', () => { const el = new El('div'); PB.ui.text('hi').mount(el); return html(el); });
t('mount(el) without a context, a lambda prop', () => { const el = new El('div'); PB.ui.text(c => c.state.n).mount(el); return html(el); });
t('mount(el, ctx) returns', () => { const el = new El('div'); const r = PB.ui.text('hi').mount(el, PB.makeCtx(PB.S.clips[id])); return Object.keys(r); });
t('board.on (guide ch.02)', () => PB.boardAPI.on('paste', () => null));
t('board.handle (guide ch.10)', () => PB.boardAPI.handle());
t('board.layout (guide ch.12)', () => PB.boardAPI.layout());
t('board.clipDefaults (guide ch.05)', () => PB.boardAPI.clipDefaults(c => c));
t('board.clip(builder).near(window).tag(...) on the page', () => { const p = PB.boardAPI.clip(PB.ui.note('hello').use(PB.fragments.taggable).tag('a')); return [Object.keys(p), p.clip.kind, p.clip.tags]; });
t('board.clip(ui.text(c => …)) (a lambda value)', () => PB.boardAPI.clip(PB.ui.text(c => 'x')).clip.text);
t('board.clip(ui.row()) refused', () => PB.boardAPI.clip(PB.ui.row()));
t('promote with a guide ch.07 mapping (clip.attr, clip.link?.url)', () => PB.boardAPI.clip(id).promote('recipes', clip => ({ title: clip.title, url: clip.link && clip.link.url, note: clip.attr('note') })));
