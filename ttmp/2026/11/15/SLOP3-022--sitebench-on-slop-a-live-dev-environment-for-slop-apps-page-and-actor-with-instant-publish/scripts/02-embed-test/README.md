# Embedded views, end to end (SLOP3-022 C.1)

Two scratch apps for a local slop built from this branch:

- `jot/`: an app whose page writes and reads a document (`db`), the app under development.
- `embedtest/`: a tool trusted with `workshop` that embeds a dev view of `jot-dev` and answers its runtime like the shell: `hello` → `{type:"view", view, secret}`, `reload` → embed again. It logs the probe's messages.

```sh
slop store new --id jot --type jot && slop push jot --store jot && slop push jot --store jot --ref draft
slop store new --id jot-dev --type jot --app jot && slop app follow jot-dev draft
slop store new --id embedtest && slop push embedtest --store embedtest
slop app trust embedtest workshop
slop mount set --host apps.localhost:18490 --path /embedtest --store embedtest
# open http://apps.localhost:18490/embedtest, then edit jot/index.html and:
slop push jot --store jot --ref draft
```

The log shows the runtime's `hello`, the probe's `ready`, `state` and console lines, and after a push `reload` and a new embed at the next version.
