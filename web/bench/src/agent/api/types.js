// agent/api/types.js — types.*: the app's type errors, from the checker
// (agent/types.js; SLOP3-024 phase 3).
//
// Public API: TYPES (an API table).
import { Types, headView } from '../types.js';

export const TYPES = {
  'types.check': {
    sig: '{file}?', long: true,
    doc: '{errors: [{file, line, col, message, program}], count} for the files as this eval sees them (its own writes included), or {skipped}: TypeScript errors in the pages and the actor, checked against the app\'s declarations',
    run: async (ctx, o = {}) => {
      const view = ctx.tx || headView(ctx.draft)
      if (!Types.wants(view)) return { errors: [], count: 0, note: 'the app has no TypeScript files' }
      const r = await Types.check(ctx.project, view, { timeoutMs: 20000, ref: ctx.draft.ref })
      if (r.skipped) return { skipped: r.skipped }
      const errors = r.diags.filter(d => !o.file || d.file === o.file).map(d => ({ file: d.file, line: d.line, col: d.col, message: d.message, program: d.program }))
      return { errors: errors.slice(0, 50), count: errors.length }
    },
  },
}
