import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { Hub, type AiProvider } from './hub';
import { randomCode, Secrets } from './secrets';
import { Store } from './store';

export interface AppOptions {
  dataDir: string;
  hostPassword?: string | null;
  secretKey?: string | null;
  staticDir?: string | null;
  ai?: AiProvider | null;
  broadcastMs?: number;
  saveDebounceMs?: number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, limit = 16_384): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function createApp(o: AppOptions) {
  const store = new Store(o.dataDir, o.saveDebounceMs ?? 1000);
  await store.init();
  const secrets = new Secrets(o.secretKey || o.hostPassword || null);
  const hub = new Hub({ store, secrets, ai: o.ai ?? null, broadcastMs: o.broadcastMs });
  const created = new Map<string, number[]>();
  const cleanup = setInterval(() => void store.cleanup(), 12 * 3600_000);
  cleanup.unref();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/api/config' && req.method === 'GET') {
        return json(res, 200, { aiEnabled: hub.aiEnabled, passwordRequired: !!o.hostPassword });
      }
      if (url.pathname === '/api/health') return json(res, 200, { ok: true });
      if (url.pathname === '/api/games' && req.method === 'POST') {
        let body: { password?: string } = {};
        try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { error: 'Bad request' }); }
        if (o.hostPassword && body.password !== o.hostPassword) return json(res, 401, { error: 'Wrong host password' });
        const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
        const now = Date.now();
        const times = (created.get(ip) ?? []).filter((t) => now - t < 3600_000);
        if (times.length >= 30) return json(res, 429, { error: 'Too many new games from here. Try again later.' });
        created.set(ip, [...times, now]);
        let code = randomCode();
        for (let i = 0; i < 20 && (await hub.codeInUse(code)); i++) code = randomCode();
        const secret = secrets.make(code);
        await hub.createRoom(code, secret);
        return json(res, 200, { code, dmSecret: secret });
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      if (!o.staticDir) { res.writeHead(404); return res.end('Not found'); }
      await serveStatic(o.staticDir, url.pathname, res);
    } catch (err) {
      console.error('[http]', err);
      if (!res.headersSent) json(res, 500, { error: 'Server error' });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 * 1024, perMessageDeflate: { threshold: 1024 } });
  wss.on('connection', (ws) => hub.connect(ws));

  return {
    server,
    hub,
    store,
    secrets,
    async close() {
      clearInterval(cleanup);
      await hub.close();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

async function serveStatic(root: string, pathname: string, res: http.ServerResponse) {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(root, safe);
  if (!path.resolve(file).startsWith(path.resolve(root))) { res.writeHead(403); return res.end(); }
  let st = await fs.stat(file).catch(() => null);
  if (!st || st.isDirectory()) {
    // SPA routes (/dm/CODE, /play/CODE) all load the app shell.
    if (path.extname(safe)) { res.writeHead(404); return res.end('Not found'); }
    file = path.join(root, 'index.html');
    st = await fs.stat(file).catch(() => null);
    if (!st) { res.writeHead(404); return res.end('Build the client first: npm run build'); }
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}
