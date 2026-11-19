import { networkInterfaces } from 'node:os';

/** This computer's addresses on the local network (home wifi and the like), best first. */
export function lanAddresses(): string[] {
  const all = Object.values(networkInterfaces()).flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : ip.startsWith('169.254.') ? 9 : 5);
  return [...new Set(all)].filter((ip) => rank(ip) < 9).sort((a, b) => rank(a) - rank(b));
}

/** Is this Host header this computer itself (so the page can't be shared as is)? */
export const isLocalHost = (host: string | undefined) => /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i.test(host ?? '');
