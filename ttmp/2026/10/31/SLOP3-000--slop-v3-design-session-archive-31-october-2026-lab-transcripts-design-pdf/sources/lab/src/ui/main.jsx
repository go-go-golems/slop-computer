// Boot: start the kernel worker, load the saved world, wire Claude and downloads, keep saving.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Client } from './client.js';
import { storage, pack, unpack, gzip, gunzip, zip, unzip, STORE_README } from './persist.js';
import { App } from './App.jsx';

const hhmm = (d = new Date()) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

function Root() {
  const [client] = useState(() => new Client(new URL('kernel.js', document.baseURI)));
  const [phase, setPhase] = useState('Starting the kernel: SQLite and QuickJS in a worker…');
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState(null);
  const [save, setSave] = useState({ label: '…', sub: 'saving', title: 'Looking for somewhere to keep the world' });
  const [outer, setOuter] = useState({ sample: null, downloads: null });
  const outerRef = useRef(outer); outerRef.current = outer;
  const st = useRef(null), dirty = useRef(false), saving = useRef(false), backoff = useRef(0);

  useEffect(() => {
    let dead = false;
    const cl = window.claude && typeof window.claude.use === 'function' ? window.claude : null;
    if (cl) Promise.all([cl.use('sample'), cl.use('downloads')]).then(([sample, downloads]) => { if (!dead) setOuter({ sample, downloads }); }, () => {});
    client.bridges.sample = async (m) => {
      const s = outerRef.current.sample;
      if (!s) { const e = new Error('Claude is not available in this view'); e.code = 'unavailable'; throw e; }
      const r = await s(m.input, { modelTier: (m.opts && m.opts.modelTier) || 'default' });
      return { text: r.text, truncated: !!r.truncated };
    };
    client.bridges.download = async (m) => {
      const d = outerRef.current.downloads;
      if (!d) { const e = new Error('downloads are not available here'); e.code = 'unavailable'; throw e; }
      return d.save(m.file);
    };
    (async () => {
      try {
        await Promise.race([client.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('the kernel worker did not start in 20 s')), 20000))]);
        setPhase('Looking for a saved world…');
        const s = await storage().catch(() => null); st.current = s;
        let images = null;
        if (s) { try { images = await s.load(); } catch (e) { console.warn('could not load the saved world', e); } }
        setPhase(images ? 'Opening your saved world…' : 'Seeding a new world…');
        try { await client.call('boot', { images }); }
        catch (e) { if (!images) throw e; console.warn('the saved world did not open; seeding a new one', e); await client.call('boot', { images: null }); }
        if (dead) return;
        setSave(s ? { label: 'saved', sub: images ? 'loaded' : 'new', title: `Kept in ${s.kind}` } : { label: 'not saved', sub: 'this visit only', bad: true, title: 'No storage here: the world lasts until you close the page. Export it from World ▾.' });
        if (!images) dirty.current = true;
        setBooted(true);
      } catch (e) { if (!dead) setBootError(e.message || String(e)); }
    })();
    const off = client.on((names) => { if (names.some(n => n === 'commit' || n === 'stores' || n === 'mounts' || n === 'access')) dirty.current = true; });
    const t = setInterval(async () => {
      if (!dirty.current || saving.current || !st.current || Date.now() < backoff.current) return;
      saving.current = true; dirty.current = false;
      setSave(x => ({ ...x, busy: true }));
      try {
        const { stores } = await client.call('exportImages');
        const bytes = await st.current.save(stores);
        setSave({ label: 'saved', sub: `${hhmm()} · ${(bytes / 1024).toFixed(0)} KB`, title: `Every store's SQLite image, gzipped, kept in ${st.current.kind}` });
      } catch (e) { dirty.current = true; backoff.current = Date.now() + 30000; setSave({ label: 'not saved', sub: short(e.message || e.code), bad: true, title: `${e.message || e.code}. Retrying in 30 s.` }); }
      saving.current = false;
    }, 8000);
    return () => { dead = true; off(); clearInterval(t); };
  }, [client]);

  const onReset = async () => { await client.call('reset'); dirty.current = true; };
  // Files leave through the downloads capability (the viewer confirms each one); outside claude.ai, a plain link.
  const saveFile = async (filename, data) => {
    const d = outerRef.current.downloads;
    if (d) { try { await d.save({ filename, data }); return true; } catch (e) { if (e && e.code === 'declined') return false; throw Object.assign(new Error(`not saved: ${(e && e.message) || (e && e.code) || e}`), { code: e && e.code }); } }
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return true;
  };
  const onExport = async () => {
    const { stores } = await client.call('exportImages');
    const ids = Object.keys(stores);
    const files = ids.map(id => ({ name: `stores/${id}.sqlite`, data: stores[id] }));
    files.push({ name: 'world.json', data: JSON.stringify({ format: 'slop-world/1', exported_at: new Date().toISOString(), stores: ids }, null, 2) });
    files.push({ name: 'README.txt', data: `A slop lab world: one SQLite file per store in stores/. Import the whole zip in the lab (World > Import world), or open any store with a SQLite tool.\n\n${STORE_README('<store>')}` });
    return saveFile(`slop-world-${new Date().toISOString().slice(0, 10)}.zip`, await zip(files));
  };
  const onImport = async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let images;
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) { // a .zip from Export world
      const entries = await unzip(bytes); images = {};
      for (const [name, b] of Object.entries(entries)) { const m = /^stores\/([a-z0-9-]+)\.sqlite$/.exec(name); if (m) images[m[1]] = b; }
    } else images = unpack(await gunzip(bytes)); // the older .slop format
    if (!images.system) throw new Error('that file is not a slop world (no stores/system.sqlite)');
    await client.call('boot', { images }); dirty.current = true;
  };

  if (bootError || !booted) return <div className="boot-screen"><div><h1>slop lab</h1>{bootError ? <><p className="bad">The lab could not start: {bootError}</p><p className="dim">The kernel runs SQLite and QuickJS as WebAssembly in a worker; this browser or frame refused one of them.</p></> : <p className="dim">{phase}</p>}</div></div>;
  return <App client={client} saveState={save} outer={outer} onReset={onReset} onExport={onExport} onImport={onImport} saveFile={saveFile} />;
}
const short = (s) => (s && s.length > 40 ? s.slice(0, 39) + '…' : s);

try { const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; } catch { /* light */ }
createRoot(document.getElementById('root')).render(<Root />);
