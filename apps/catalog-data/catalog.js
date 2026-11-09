// SLOP3-018: what the catalog's actor knows about items, apart from SQL.
//
//   normalize(x)            checks one item as the importer sends it (the
//                           item shape of SLOP3-015's catalog.json) and
//                           returns it with its fields in a fixed order
//   matches(item, words)    every word in the title, description, id or tags
//   haystack(item)          the lower-case text a query is matched against
//   atom(cat), searchIndex(cat), llmsTxt(cat)
//                           the files 01-build-catalog.py used to write, from
//                           the catalog object /catalog.json returns
//
// Nothing here reads or writes the store.

function bad(message) {
  const e = new Error(message);
  e.code = 'invalid_argument';
  throw e;
}

const FIELDS = ['id', 'title', 'description', 'tags', 'featured', 'version', 'publishedAt', 'free', 'capabilities',
  'bytes', 'attachments', 'cover', 'open', 'preview', 'download', 'releases'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// A link in an item becomes an href or a src in the views: an https URL or
// a path on the site host, never javascript: or data:.
const LINK = /^(https:\/\/[^\s"'<>\\]+|\/[^\s"'<>\\]*)$/;

function str(v, what, max, opt) {
  if (v === undefined || v === null) {
    if (opt) return null;
    bad(what + ' is required');
  }
  if (typeof v !== 'string') bad(what + ' is a string');
  if (v.length > max) bad(what + ' is at most ' + max + ' characters');
  return v;
}

function link(v, what) {
  if (v === undefined || v === null) return null;
  str(v, what, 2048);
  if (!LINK.test(v)) bad(what + ' is an https URL or a path on the site host');
  return v;
}

function when(v, what) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !ISO.test(v)) bad(what + ' is a UTC time such as 2026-10-25T22:39:04Z');
  return v;
}

function strings(v, what, max) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) bad(what + ' is a list of strings');
  if (v.length > max) bad(what + ' has at most ' + max + ' entries');
  return v.map((s, i) => str(s, what + '[' + i + ']', 64));
}

function count(v, what) {
  if (v === undefined || v === null) return 0;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) bad(what + ' is a whole number, 0 or more');
  return v;
}

function release(r, what) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) bad(what + ' is an object {version, publishedAt, changelog}');
  for (const k of Object.keys(r)) if (!['version', 'publishedAt', 'changelog'].includes(k)) bad(what + ' has an unknown field ' + k);
  return { version: str(r.version, what + '.version', 64), publishedAt: when(r.publishedAt, what + '.publishedAt'),
    changelog: str(r.changelog, what + '.changelog', 20000, true) || '' };
}

// normalize checks an item and returns it with today's key order. Unknown
// fields are refused: the actor defines the shape the views read.
function normalize(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) bad('an item is an object');
  for (const k of Object.keys(x)) if (!FIELDS.includes(k)) bad('unknown field ' + k + ' (an item has ' + FIELDS.join(', ') + ')');
  const id = str(x.id, 'id', 128);
  if (!ID.test(id)) bad('id ' + JSON.stringify(id) + ' is not a store id');
  if (typeof x.free !== 'boolean') bad('free is true or false');
  const cover = x.cover === undefined || x.cover === null ? null : (() => {
    if (typeof x.cover !== 'object' || Array.isArray(x.cover)) bad('cover is {src, width, height} or null');
    const w = x.cover.width, h = x.cover.height;
    return { src: link(x.cover.src, 'cover.src') || bad('cover.src is required'),
      width: w === undefined || w === null ? null : count(w, 'cover.width'),
      height: h === undefined || h === null ? null : count(h, 'cover.height') };
  })();
  if (x.attachments !== undefined && x.attachments !== null && !Array.isArray(x.attachments)) bad('attachments is a list');
  const attachments = (x.attachments || []).slice(0, 100).map((a, i) => {
    const w = 'attachments[' + i + ']';
    if (!a || typeof a !== 'object') bad(w + ' is an object {name, label, size, href}');
    const name = str(a.name, w + '.name', 256);
    return { name, label: str(a.label, w + '.label', 256, true) || name, size: count(a.size, w + '.size'), href: link(a.href, w + '.href') };
  });
  const out = {
    id,
    title: str(x.title, 'title', 300),
    description: str(x.description, 'description', 4000, true) || '',
    tags: strings(x.tags, 'tags', 64),
    featured: x.featured === true,
    version: str(x.version, 'version', 64, true),
    publishedAt: when(x.publishedAt, 'publishedAt'),
    free: x.free,
    capabilities: strings(x.capabilities, 'capabilities', 32),
    bytes: count(x.bytes, 'bytes'),
    attachments,
    cover,
    open: link(x.open, 'open'),
    preview: link(x.preview, 'preview'),
    download: link(x.download, 'download'),
  };
  if (x.releases !== undefined && x.releases !== null) {
    if (!Array.isArray(x.releases) || x.releases.length > 500) bad('releases is a list of at most 500');
    out.releases = x.releases.map((r, i) => release(r, 'releases[' + i + ']'));
  }
  return out;
}

function haystack(i) {
  return (i.title + ' ' + i.description + ' ' + i.id + ' ' + i.tags.join(' ')).toLowerCase();
}

function words(q) {
  return String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 20);
}

function matches(i, ws) {
  const hay = haystack(i);
  return ws.every((w) => hay.includes(w));
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c]));

function host(origin) {
  return String(origin || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'slop';
}

// atom: one entry per release (or per app, without history), newest first.
function atom(cat) {
  const site = cat.siteOrigin, tagHost = host(site).replace(/^site\./, '');
  const entries = [];
  for (const i of cat.items) {
    const rels = i.releases && i.releases.length ? i.releases : [{ version: i.version, publishedAt: i.publishedAt, changelog: '' }];
    rels.forEach((r, k) => {
      const first = k === rels.length - 1;
      const title = i.title + ' ' + (r.version || '') + (first ? '' : ' (update)');
      const link = site + '/catalog/list/?open=' + encodeURIComponent(i.id);
      const at = r.publishedAt || cat.generated;
      entries.push([at, '  <entry>\n' +
        '    <id>tag:' + esc(tagHost) + ',2026:catalog/' + esc(i.id) + '/' + esc(r.version || '') + '</id>\n' +
        '    <title>' + esc(title) + '</title>\n' +
        '    <updated>' + esc(at) + '</updated>\n' +
        '    <link rel="alternate" type="text/html" href="' + esc(link) + '"/>\n' +
        (i.open ? '    <link rel="related" type="text/html" href="' + esc(i.open) + '"/>\n' : '') +
        '    <summary>' + esc(r.changelog || i.description) + '</summary>\n' +
        i.tags.map((t) => '    <category term="' + esc(t) + '"/>\n').join('') +
        '  </entry>\n']);
    });
  }
  entries.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  const updated = entries.length ? entries[0][0] : cat.generated;
  return '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<feed xmlns="http://www.w3.org/2005/Atom">\n' +
    '  <id>tag:' + esc(tagHost) + ',2026:catalog</id>\n' +
    '  <title>slop catalog</title>\n' +
    '  <subtitle>Releases of the apps imported from slop.boutique, running on slop.</subtitle>\n' +
    '  <updated>' + esc(updated) + '</updated>\n' +
    '  <link rel="self" type="application/atom+xml" href="' + esc(cat.api + '/feed.xml') + '"/>\n' +
    '  <link rel="alternate" type="text/html" href="' + esc(site + '/catalog/timeline/') + '"/>\n' +
    entries.map((e) => e[1]).join('') + '</feed>\n';
}

// searchIndex: one flat record per app, with a text field to match against.
function searchIndex(cat) {
  const site = cat.siteOrigin;
  return {
    generated: cat.generated, count: cat.count,
    fields: ['id', 'title', 'description', 'tags', 'capabilities', 'access', 'version', 'publishedAt', 'bytes', 'open', 'html', 'text'],
    apps: cat.items.map((i) => ({
      id: i.id, title: i.title, description: i.description, tags: i.tags, capabilities: i.capabilities,
      access: i.free ? 'free' : 'subscribers', version: i.version, publishedAt: i.publishedAt, bytes: i.bytes, open: i.open,
      html: i.download ? site + i.download : null,
      text: [i.title, i.description, i.id].concat(i.tags).join(' ').toLowerCase(),
    })),
  };
}

// llmsTxt: what the catalog is, where its data is, and every app (https://llmstxt.org).
function llmsTxt(cat) {
  const site = cat.siteOrigin, api = cat.api;
  const lines = [
    '# slop catalog', '',
    '> ' + cat.count + ' single-file HTML apps imported from slop.boutique, running on slop (' + cat.appsOrigin + '). ' +
      'Free apps can be opened, previewed and downloaded by anyone; the rest are for subscribers.', '',
    'Every app is one HTML file. Apps may declare slop runtime capabilities: sample (model calls), ' +
      'db (shared documents), room (real-time presence), user (who is looking), downloads (save files).', '',
    '## For agents', '',
    '- [MCP endpoint](' + cat.mcp + '): read-only, Streamable HTTP (JSON answers, stateless); tools search_apps, get_app, list_tags, list_capabilities',
    '- [Search](' + api + '/apps?q=): GET with q, tag, cap, free, sort, limit and offset; JSON',
    '- [search-index.json](' + api + '/search-index.json): one flat record per app, with a lower-case text field',
    '- [catalog.json](' + api + '/catalog.json): the full catalog the views read',
    '- [feed.xml](' + api + '/feed.xml): Atom, one entry per release',
    '- [Agents page](' + site + '/catalog/agents/): how to connect, with examples', '',
    '## Apps', '',
  ];
  for (const i of cat.items) {
    const extra = [i.tags.slice(0, 4).join(', '), i.capabilities.length ? 'runtime: ' + i.capabilities.join('+') : '',
      i.free ? 'free' : 'subscribers'].filter(Boolean).join(', ');
    lines.push('- [' + i.title + '](' + i.open + '): ' + i.description + ' (' + extra + ')');
  }
  return lines.join('\n') + '\n';
}

module.exports = { FIELDS, normalize, haystack, words, matches, atom, searchIndex, llmsTxt, bad };
