// The back office as an app (SLOP3-002). Its page calls one action, verb,
// with the names the built-in back office posts to /api/v1; the system
// module runs each as the visiting person, so only what they could do
// directly happens, logged as via app:<this store>. Install:
//   slop push apps/backoffice --store backoffice
//   slop app trust backoffice system
//   slop mount set <live host> /admin backoffice
const system = use('system');
const db = use('db');

defineActor({
  actions: {
    verb(ctx, { name, args }) {
      ctx.need('admin');
      if (!system) ctx.fail('unavailable', 'this app is not trusted with the system module (slop app trust <store> system)');
      return system.call(String(name), args || {});
    },
  },
  on: {
    // Changes made anywhere (the CLI, another tool) refresh open pages.
    'system:*'(ctx, e) { db.doc('ui/changed').set({ rev: e.rev, at: e.at }); },
  },
});
