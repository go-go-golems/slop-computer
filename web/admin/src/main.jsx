// slop's back office: one window, a strip of surfaces, the lab's design
// system (lab/dist/styles.css).
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { session, signOut } from './api.js';
import { Activity, Apps, Explain, LLM, People, Sites, Stores } from './views.jsx';

const SURFACES = [
  ['activity', 'Activity', Activity],
  ['people', 'People', People],
  ['llm', 'LLM', LLM],
  ['apps', 'Apps', Apps],
  ['stores', 'Stores', Stores],
  ['sites', 'Sites', Sites],
  ['explain', 'Explain', Explain],
];

function App({ me, hosts }) {
  const [tab, setTab] = useState(() => (location.hash.slice(1) || 'activity'));
  const [toasts, setToasts] = useState([]);
  useEffect(() => { const f = () => setTab(location.hash.slice(1) || 'activity'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const toast = useCallback((text, bad) => {
    const id = Math.random();
    setToasts(t => [...t.slice(-3), { id, text, bad }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), bad ? 6000 : 3000);
  }, []);
  const [, , C] = SURFACES.find(s => s[0] === tab) || SURFACES[0];
  return (
    <div className="shell">
      <header className="bar">
        <span className="brand">slop <i>back office</i></span>
        <nav className="dtabs" aria-label="Surfaces">{SURFACES.map(([k, label]) => (
          <a key={k} href={'#' + k} className={'dtab' + (k === tab ? ' on' : '')} aria-current={k === tab ? 'page' : undefined}>{label}</a>))}</nav>
        <span className="sp" />
        <span className="dim">{me.person.name || me.person.email} · {me.person.role}</span>
        <button className="btn" onClick={signOut}>Sign out</button>
      </header>
      <main className="main"><C toast={toast} hosts={hosts} /></main>
      <div className="otoasts" role="status">{toasts.map(t => <div key={t.id} className={'otoast' + (t.bad ? ' bad' : '')}>{t.text}</div>)}</div>
    </div>
  );
}

function Gate() {
  const [s, setS] = useState(null);
  useEffect(() => { session().then(setS, () => setS({ signedIn: false })); }, []);
  if (!s) return null;
  if (!s.signedIn) { location.assign('/auth/login?return=/'); return null; }
  if (s.person.role !== 'admin') return <div className="gate"><h1>slop</h1><p>The back office is for admins. You are signed in as {s.person.email}.</p><button className="btn" onClick={signOut}>Sign out</button></div>;
  const boot = JSON.parse(document.getElementById('slop-admin').textContent);
  return <App me={s} hosts={boot.hosts} />;
}

createRoot(document.getElementById('root')).render(<Gate />);
