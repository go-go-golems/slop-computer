---
Title: "Alarms: scheduled jobs on the server"
Slug: "alarms"
Short: "Run code on a schedule (every morning at 7, every 5 minutes): declare it in actor.js, know its time zone, try it now with alarm fire --at, and check that it ran."
Topics:
- actors
- alarms
- schedules
- cron
Commands:
- alarm
- app
- log
Flags:
- at
IsTopLevel: true
IsTemplate: false
ShowPerDefault: true
SectionType: GeneralTopic
---
An alarm is code in an app's actor (`actor.js`) that the server runs on a
schedule: "every morning at 7, count the open tasks", "every 5 minutes,
expire old entries". There is no process to run, no cron daemon to install
and no npm package such as node-cron: the server keeps the schedule,
wakes the store's actor at the time, and runs the handler in one
transaction. This page shows how to declare one, which time zone it runs in,
how to try it without waiting, and how to tell that a scheduled run
happened. The full actor API is `slop help actors`.

## Declare it

Recurring alarms go in the actor's `every`. Each has a name, a schedule and
a handler:

```js
// actor.js
const db = use('db');
defineActor({
  every: {
    digest: {
      every: '0 7 * * *',                       // 07:00 every day, server time
      run(ctx) {
        const open = db.collection('tasks').where('done', '==', false).get().size;
        db.doc('meta/digest').set({ open, at: ctx.now });
      },
    },
    cleanup: { every: '1h', run(ctx) { /* … */ } },
  },
});
```

A schedule is a Go duration (`'30s'`, `'5m'`, `'1h'`, at least 1 s),
`'@every 5m'`, a descriptor (`'@hourly'`, `'@daily'`) or a five-field cron
line (minute, hour, day of month, month, day of week: `'0 9 * * 1'` is
Mondays at 09:00). Push the app; the alarms are registered when the new
version activates, and dropped when a later version no longer declares them.

The page shows what the alarm wrote like any other document:

```js
const db = await claude.use('db');
db.doc('meta/digest').onSnapshot((d) => {
  if (d.exists) banner.textContent = d.data().open + ' tasks open (as of ' + new Date(d.data().at).toLocaleString() + ')';
});
```

## Which time zone

**A cron line runs in the server's local time zone.** It is not the zone of
the person who asked, and not UTC unless the server is set to UTC. `slop
alarm ls` says which zone it is and when the next run is:

```sh
$ slop alarm ls tasks
- at: 1795694400000
  every: 0 7 * * *
  in: 15h 56m
  name: digest
  next: 2026-11-26 07:00 EST
  running: 0
  zone: America/New_York
```

To run at a time in a particular zone, start the schedule with
`CRON_TZ=<IANA zone>`. It applies to that alarm only:

```js
digest: { every: 'CRON_TZ=Europe/Berlin 0 7 * * *', run(ctx) { … } },   // 07:00 in Berlin
```

`alarm ls` then shows `zone: Europe/Berlin` and the next run in CET or
CEST. Durations (`'1h'`) do not depend on a zone.

When you tell someone "it runs at 7", name the zone; if the page shows the
time, say it there too.

## Try it now: alarm fire

`slop alarm fire <store> <name>` runs one alarm now, waits for its handler
(up to 15 s) and says how it went:

```sh
$ slop alarm fire tasks digest
fired: digest
status: ok
```

A handler that throws answers `status: failed` with the error, and nothing
it wrote is kept.

To see what the 7 o'clock run will do, give `--at`: the handler sees that
time as `ctx.now` (and `Date.now()`), so code that picks "today's" tasks
picks the right day. The schedule is not moved, and documents keep their
real timestamps.

```sh
$ slop alarm fire tasks digest --at 07:00          # the next 07:00 in the alarm's zone
fired: digest
now: "2026-11-26T07:00:00-05:00"
status: ok
$ slop alarm fire tasks digest --at next           # its next scheduled time
$ slop alarm fire tasks digest --at "2026-12-01 07:00"
$ slop alarm fire tasks digest --at 2026-12-01T07:00:00+01:00
```

Do not change the schedule to `* * * * *` to test it: you have to remember to
change it back, and an every-minute job may run before you do.

## Check that it ran

`slop alarm ls` keeps each alarm's last run:

```sh
$ slop alarm ls tasks
- name: digest
  last: 2026-11-26 07:00 EST     # when it ran
  lastVia: alarm                 # alarm: the scheduler; alarm fire: someone, by hand
  lastOk: true                   # false: lastError says why
  next: 2026-11-27 07:00 EST
  …
```

`lastAsOf` appears when the run was `alarm fire --at`: the time the handler
was given. `lastLate: true` means it fired late, after the server had been
down at the scheduled time.

The store's log shows what each run wrote, with `via: alarm`:

```sh
slop log show tasks          # newest first; an alarm's commit says via: alarm (alarm fire by hand)
slop app logs tasks          # a failed run: "alarm digest failed: …"
```

## When a run fails

The handler's whole turn rolls back: nothing it wrote is kept. A scheduled
run that failed runs again a minute later, and keeps doing so until it
succeeds or the next version of the app fixes it; each failure is a line in
`slop app logs <store>` and the last one is in `alarm ls` (`lastOk: false`,
`lastError`). Nobody else is told. An alarm missed while the server was
down fires once when it is back, with `ctx.event.late` true.

## One-shot alarms

An alarm can also be set from code, once, and handled in `alarms`:

```js
const alarm = use('alarm');
defineActor({
  actions: {
    remind: { requires: 'interact', run(ctx, { text }) {
      alarm.at(ctx.now + 15 * 60_000, 'remind', { text });   // in 15 minutes
    } },
  },
  alarms: {
    remind(ctx, data) { /* data is { text } */ },
  },
});
```

Setting the same name again moves it; `alarm.cancel(name)` removes it;
`alarm.list()` lists them. A recurring alarm set from code
(`alarm.every(name, spec)`) is removed at the next activation unless `every`
declares it: declare schedules in `every`.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| `alarm ls` is empty right after a push | Alarms are registered when the new version's actor starts, a moment after the push | `slop app status <store>` (is it broken?), then `alarm ls` again |
| It ran at the wrong hour | Cron runs in the server's zone (`zone:` in `alarm ls`) | Start the spec with `CRON_TZ=<zone>`, push |
| `not_found: tasks has no alarm "x"` | No alarm by that name | `slop alarm ls tasks` lists them |
| `status: failed` with an error | The handler threw; nothing was written | Fix it, push, `alarm fire` again |
| `lastOk: false` every few minutes | A scheduled run fails and is retried each minute | `slop app logs <store>`; fix and push |
| `--at "seven"` is refused | `--at` takes `next`, `HH:MM`, `"YYYY-MM-DD HH:MM"` or RFC 3339 | `--at 07:00` |
| The page shows the old number | The alarm has not run since | `slop alarm fire <store> <name>` |
| `ReferenceError: Intl is not defined` | The actor runtime has no `Intl` | Store numbers and `ctx.now`; format them in the page |

## See Also

- `slop help actors` — the actor API: actions, `ctx`, documents, SQL, reactors
- `slop help capability-db` — showing what the alarm wrote on the page
- `slop help deploying-apps` — push, activation, `app status`
