import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { normalizeCode } from '../shared/types';
import { DmApp } from './dm/DmApp';
import { Home } from './Home';
import { PlayerApp } from './player/PlayerApp';
import { Dialogs, Toasts } from './ui';
import './styles.css';

function route() {
  const parts = location.pathname.split('/').filter(Boolean);
  if (parts[0] === 'dm' && parts[1]) return { page: 'dm' as const, code: normalizeCode(parts[1]) };
  if ((parts[0] === 'play' || parts[0] === 'p') && parts[1]) return { page: 'play' as const, code: normalizeCode(parts[1]) };
  return { page: 'home' as const, code: '' };
}

function App() {
  const [r, setR] = useState(route());
  useEffect(() => {
    const on = () => setR(route());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return (
    <>
      {r.page === 'dm' ? <DmApp key={r.code} code={r.code} /> : r.page === 'play' ? <PlayerApp key={r.code} code={r.code} /> : <Home />}
      <Toasts />
      <Dialogs />
    </>
  );
}

render(<App />, document.getElementById('app')!);
