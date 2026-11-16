const ws = use('workshop');
defineActor({
  actions: {
    embed: { requires: 'view', async run(ctx, { store, dev }) { return await ws.embed(store, { dev }); } },
    renew: { requires: 'view', async run(ctx, { view }) { return await ws.renewEmbed(view); } },
  },
});
