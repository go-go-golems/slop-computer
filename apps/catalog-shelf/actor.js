// SLOP3-018: the Shelf's one action, the catalog. It is catalog-data's,
// read through the binding "catalog" (bind.set catalog-shelf catalog
// catalog-data, and grant.set catalog-data store:catalog-shelf view). The
// page cannot fetch catalog-data's routes itself: it runs on its own
// sandbox origin.
const stores = use('stores');

defineActor({
  actions: {
    catalog: { requires: 'view', run: () => stores.open('catalog').call('catalog', {}) },
  },
});
