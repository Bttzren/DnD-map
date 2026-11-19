// Where players should go. On a hosted site that's this site. When the DM
// opened the app on this computer ("localhost"), phones can't use that, so we
// use the computer's address on the local wifi instead.
import { useEffect, useReducer } from 'preact/hooks';
import { pref } from './local';

export const isLocalPage = () => typeof location !== 'undefined' && /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(location.hostname);

let lan: string[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || !isLocalPage()) return;
  loaded = true;
  fetch('/api/config').then((r) => r.json()).then((c: { lanUrls?: string[] }) => {
    lan = Array.isArray(c.lanUrls) ? c.lanUrls.filter((u) => typeof u === 'string') : [];
    listeners.forEach((f) => f());
  }).catch(() => { loaded = false; });
}

/** The address players should open. */
export function playerOrigin(): string {
  if (!isLocalPage()) return location.origin;
  const pick = pref.get<string>('lanUrl', '');
  return lan.includes(pick) ? pick : lan[0] ?? location.origin;
}

/** Re-renders when the local network addresses arrive. */
export function useOrigins() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const f = () => bump(undefined);
    listeners.add(f); load();
    return () => { listeners.delete(f); };
  }, []);
  return {
    origin: playerOrigin(),
    local: isLocalPage(),
    lan,
    choose: (url: string) => { pref.set('lanUrl', url); listeners.forEach((f) => f()); },
  };
}
