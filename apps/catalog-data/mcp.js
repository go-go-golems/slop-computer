// SLOP3-015 view 4, moved into catalog-data by SLOP3-018: a read-only MCP
// server over the catalog, for agents.
//
// The actor routes POST / (and GET /, which says what this is) here. It
// speaks JSON-RPC 2.0 as MCP's Streamable HTTP transport allows for a
// stateless server: each POST gets one JSON answer (no SSE, no session).
// The catalog comes from the store's tables on every message (lib), so
// a new release shows up at once. Nothing is written anywhere.
//
//   mcp.answer(message, lib) -> the JSON-RPC answer, or null for a notification
//   mcp.TOOLS                -> the tool names, for GET /
//
// lib is { catalog(), item(id), search({words, tag, cap, free}) }, the
// actor's reads.
const C = require('./catalog.js');

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const CAPS = {
  sample: 'Ask a model (window.claude.sample on slop\'s model backend), metered per person.',
  db: 'Documents shared by the app\'s viewers, with rules; data/users/<id>/ is private to each person.',
  room: 'Real-time presence and events between the people who have the app open.',
  user: 'Who is looking: id when declared, name only with the profile scope.',
  downloads: 'Save a file to the viewer\'s computer, behind a confirmation.',
};

function card(i) {
  return { id: i.id, title: i.title, description: i.description, tags: i.tags, capabilities: i.capabilities,
    access: i.free ? 'free' : 'subscribers', version: i.version, publishedAt: i.publishedAt, bytes: i.bytes, open: i.open };
}

function full(i, site) {
  return Object.assign(card(i), {
    html: i.download ? site + i.download : null,
    viewer: site + '/catalog/list/?open=' + encodeURIComponent(i.id),
    cover: i.cover ? site + i.cover.src : null,
    attachments: (i.attachments || []).map((a) => ({ name: a.name, label: a.label, size: a.size, href: a.href ? site + a.href : null })),
    releases: i.releases || [{ version: i.version, publishedAt: i.publishedAt, changelog: '' }],
  });
}

// search: every word of the query in the title, description, id or tags;
// title hits first, then newest.
function search(a, lib) {
  const words = C.words(a.query);
  const limit = Math.max(1, Math.min(50, Number(a.limit) || 10));
  const hits = lib.search({ words, tag: a.tag, cap: a.capability, free: a.free_only ? true : undefined })
    .map((i) => [words.filter((w) => i.title.toLowerCase().includes(w)).length, i])
    .sort((x, y) => y[0] - x[0] || String(y[1].publishedAt).localeCompare(String(x[1].publishedAt)));
  return { total: hits.length, apps: hits.slice(0, limit).map(([, i]) => card(i)) };
}

const TOOLS = [
  { name: 'search_apps', title: 'Search apps',
    description: 'Find apps in the slop catalog (single-file HTML apps imported from slop.boutique). Every word of query must appear in the title, description, id or tags. Filters combine.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Words to look for; empty lists everything' },
      tag: { type: 'string', description: 'Only apps with this tag (see list_tags)' },
      capability: { type: 'string', enum: Object.keys(CAPS), description: 'Only apps that declare this runtime capability' },
      free_only: { type: 'boolean', description: 'Only apps anyone may open and download' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } } },
    run: search },
  { name: 'get_app', title: 'Get an app',
    description: 'Everything the catalog knows about one app: description, tags, runtime capabilities, access, size, release history, and links to open it, view it and (when free) download its HTML.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The app id, as search_apps returns it' } }, required: ['id'] },
    run: (a, lib) => {
      const i = typeof a.id === 'string' ? lib.item(a.id) : null;
      if (!i) throw { code: -32602, message: 'no app with id ' + JSON.stringify(a.id) };
      return full(i, lib.catalog().siteOrigin);
    } },
  { name: 'list_tags', title: 'List tags',
    description: 'The catalog\'s tags with how many apps carry each, most used first.',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 } } },
    run: (a, lib) => {
      const tags = lib.catalog().tags;
      return { total: tags.length, tags: tags.slice(0, Math.max(1, Math.min(500, Number(a.limit) || 50))) };
    } },
  { name: 'list_capabilities', title: 'List runtime capabilities',
    description: 'The slop runtime capabilities the apps declare, what each gives a page, and how many apps declare it.',
    inputSchema: { type: 'object', properties: {} },
    run: (a, lib) => {
      const n = new Map(); // capability names are data: a Map, not an object's keys
      lib.catalog().items.forEach((i) => i.capabilities.forEach((c) => n.set(c, (n.get(c) || 0) + 1)));
      return { capabilities: [...n.keys()].sort((a, b) => n.get(b) - n.get(a)).map((c) => ({ name: c, apps: n.get(c),
        meaning: Object.prototype.hasOwnProperty.call(CAPS, c) ? CAPS[c] : '' })) };
    } },
];

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// answer handles one JSON-RPC message; null for a notification.
function answer(m, lib) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return err(m && m.id !== undefined ? m.id : null, -32600, 'not a JSON-RPC 2.0 request');
  if (m.id === undefined) return null; // notifications/initialized and friends
  const p = m.params || {};
  switch (m.method) {
    case 'initialize': {
      const catalog = lib.catalog();
      return ok(m.id, {
        protocolVersion: VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'slop-catalog', title: 'slop catalog', version: catalog.generated },
        instructions: `Read-only search over the slop catalog: ${catalog.count} single-file HTML apps from slop.boutique, running on slop at ${catalog.appsOrigin}. Use search_apps to find apps and get_app for one app's details and links.`,
      });
    }
    case 'ping':
      return ok(m.id, {});
    case 'tools/list':
      return ok(m.id, { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
        annotations: { readOnlyHint: true, openWorldHint: false } })) });
    case 'tools/call': {
      const t = TOOLS.find((x) => x.name === p.name);
      if (!t) return err(m.id, -32602, 'unknown tool ' + JSON.stringify(p.name));
      try {
        const out = t.run(p.arguments || {}, lib);
        return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out, isError: false });
      } catch (e) {
        if (e && e.code === -32602) return ok(m.id, { content: [{ type: 'text', text: e.message }], isError: true });
        throw e;
      }
    }
    default:
      return err(m.id, -32601, 'no method ' + m.method);
  }
}

module.exports = { answer, err, TOOLS: TOOLS.map((t) => t.name) };
