// agent/api/app.js — app.* and publish.*: the person's instances of the app
// and publishing it.
//
// The dev instance runs draft on data of its own; the canvas shows it. The
// test instance is reset and seeded for each scenario run; reads may look
// at it too ({kind: 'test'}). Seeding and resetting change the dev
// instance's data at once: they are not part of the eval's transaction, and
// are refused in dry runs (declared writes: 'dev'). Publishing moves main:
// the person approves it on a card first.
//
// Public API: APP (an API table).
import { FrameHosts } from '../../frames/host.js';
import { Instances, Watch } from '../../server/instances.js';
import { Publish } from '../../server/publish.js';
import { Slop } from '../../server/slop.js';
import { clamp } from '../../lib/util.js';

const READ_KINDS = ['dev', 'test']
// app.sql(q, { kind: 'test' }): options in the args' place ("at /args: got object, want array", round 5)
const argsOpts = (args, o) => args && typeof args === 'object' && !Array.isArray(args) && o === undefined ? [[], args] : [args || [], o]
const kindOf = o => {
  const k = (o && o.kind) || 'dev'
  if (!READ_KINDS.includes(k)) throw Object.assign(new Error('kind is dev or test'), { kind: 'invalid' })
  return k
}

// an instance that is not up yet (right after a reset, or never opened) is started, and the call
// tried once more: agents met "no store <app>-dev-…" after app.reset (persona reviews)
const onInstance = async (ctx, o, call) => {
  try { return await call() } catch (e) {
    if (!/no store/i.test(String(e && e.message))) throw e
    await Instances.ensure(ctx.project, kindOf(o))
    return call()
  }
}

// app.sql is read-only: SQLite's bare "not authorized" for a write says what to use instead
const readOnly = p => p.catch(e => { if (/not authorized/i.test(String(e && e.message))) throw Object.assign(new Error('app.sql only reads (SELECT): to change rows of the dev or test instance use app.exec(query, args, {kind})'), { kind: 'invalid' }); throw e })

export const APP = {
  'app.info': {
    sig: '', doc: '{app, refs: {draft, main, proposal/…}, entry, workspace, instances: {dev, test, props: [one per proposal]}}',
    run: ctx => {
      const P = ctx.project, st = Watch.status || {}
      return { app: P.app, refs: P.refs, entry: Instances.entry(P), workspace: ctx.ws, instances: { dev: st.dev || null, test: st.test || null, props: st.props || [] } }
    }
  },
  'app.addresses': { sig: '', doc: '{urls: [{url, kind}]}: where the published app is on the web (the mounts serving it); none means an administrator has not given it an address yet. Tell the person their link after a publish.', run: ctx => Slop.call('addresses', { app: ctx.project.app }) },
  'app.status': { sig: '', doc: 'where the refs are and what each instance runs: {refs, dev, test, prop} ({id, ref, n, broken})', run: ctx => Slop.call('status', { app: ctx.project.app }) },
  'app.logs': {
    sig: '{limit, kind}?', doc: '{broken, lines: [{at, level, text}]}: the instance\'s actor console, setup and activation failures (kind: dev, test, or prop for the proposal this eval writes to)',
    run: async (ctx, o = {}) => {
      // kind 'prop': the proposal this eval writes to (a proposal's preview instance; round 4 asked for it)
      const prop = o && o.kind === 'prop'
      if (prop && !/^proposal\//.test(ctx.ws || '')) throw Object.assign(new Error('kind prop is the proposal this eval writes to, and it writes to ' + (ctx.ws || 'draft')), { kind: 'invalid' })
      const r = await Slop.call('logs', prop ? { app: ctx.project.app, kind: 'prop', ref: ctx.ws } : { app: ctx.project.app, kind: kindOf(o) })
      return { broken: r.broken || '', lines: (r.lines || []).slice(-clamp(+o.limit || 50, 1, 300)) }
    }
  },
  'app.docs': { sig: 'coll, {kind}?', ret: '[{path, body}]', doc: 'the documents of a collection', run: (ctx, coll, o) => onInstance(ctx, o, () => Slop.call('docs', { app: ctx.project.app, kind: kindOf(o), coll })) },
  'app.doc': { sig: 'path, {kind}?', doc: 'one document ("coll/id")', run: (ctx, path, o) => onInstance(ctx, o, () => Slop.call('doc', { app: ctx.project.app, kind: kindOf(o), path })) },
  'app.sql': { sig: 'query, args?, {kind}?', ret: '[{column: value, …}]: rows as objects', doc: 'rows (read-only SQL on the instance\'s tables)', run: (ctx, query, a0, o0) => { const [args, o] = argsOpts(a0, o0); return readOnly(onInstance(ctx, o, () => Slop.call('sql', { app: ctx.project.app, kind: kindOf(o), query, args: args || [] }))) } },
  'app.exec': {
    sig: 'query, args?, {kind}?', doc: 'runs SQL that may write (INSERT, UPDATE, DELETE) on the dev instance\'s tables (or the test instance: {kind: \'test\'}); for removing the test rows you added, one by one', writes: 'dev',
    run: (ctx, query, a0, o0) => { const [args, o] = argsOpts(a0, o0); return onInstance(ctx, o, () => Slop.call('exec', { app: ctx.project.app, kind: kindOf(o), query, args: args || [] })) },
  },
  'app.seed': {
    sig: '{docs, tables}', doc: 'adds data to the dev instance: docs {coll: [rows]} (a row\'s id field names its document), tables {name: [rows]} (tables a migration made)', writes: 'dev',
    run: async (ctx, spec) => {
      const r = await Slop.call('seed', { app: ctx.project.app, kind: 'dev', docs: spec.docs || {}, tables: spec.tables || {} })
      // the frames show the new data (a persona saw "No shipments yet" after a seed)
      await Promise.all([...FrameHosts].filter(fh => fh.project === ctx.project && fh.kind === 'dev').map(fh => fh.load({ keepState: true })))
      return r
    }
  },
  'app.reset': {
    sig: '{why}', doc: 'asks the person with an approval card, then drops ALL the dev instance\'s data (what they entered too) for a fresh one on draft. Only when a migration changed in a way old rows cannot follow; never to clean up test data', writes: 'dev', long: true,
    run: async (ctx, o = {}) => {
      const P = ctx.project
      // it destroys what the person typed into their app: theirs to decide (two persona reviews lost data to it)
      const ok = await ctx.approve('Reset the dev data of ' + P.app + '?', 'Every row and document in your dev instance goes, including what you entered yourself. The app\'s code is not touched.' + (o && o.why ? '\nWhy: ' + o.why : ''))
      if (!ok) throw Object.assign(new Error('the person declined the reset'), { kind: 'approval' })
      const r = await Instances.reset(P, 'dev')
      await Instances.ensure(P, 'dev') // the fresh instance is up before the next call reads it
      await Promise.all([...FrameHosts].filter(fh => fh.project === P && fh.kind === 'dev').map(fh => fh.load({ keepState: false })))
      return r
    }
  },
  // publishing is the person's: the agent checks, and asks with an approval card
  'publish.check': {
    sig: '', doc: 'what publishing would do: {refs, added, changed, removed, migrations, blockers, production, dev, summary}', long: true,
    run: async ctx => { const pf = await Publish.preflight(ctx.project); return { ...pf, summary: Publish.lines(pf) } }
  },
  'publish.run': {
    sig: '{note}?', doc: 'asks the person with an approval card; publishes draft to main only if they approve', writes: 'main', long: true,
    run: async (ctx, o = {}) => {
      const P = ctx.project, pf = await Publish.preflight(P)
      if (pf.refs.draft === pf.refs.main) return { published: false, why: 'main is already draft ' + pf.refs.draft }
      if (pf.blockers.length) throw Object.assign(new Error('not publishable: ' + pf.blockers.join('; ')), { kind: 'policy' })
      const note = o.note ? String(o.note) : ''
      const ok = await ctx.approve('Publish draft ' + pf.refs.draft + ' of ' + P.app + ' to main?', [note, ...Publish.lines(pf)].filter(Boolean).join('\n'))
      if (!ok) throw Object.assign(new Error('the person declined to publish'), { kind: 'approval' })
      const r = await Publish.run(P, pf, ctx.who, note)
      return { published: true, n: r.n, from: r.from, rollback: 'publishing ' + r.from + ' again rolls back; the person can do it from the rollout dialog' }
    }
  },
}
