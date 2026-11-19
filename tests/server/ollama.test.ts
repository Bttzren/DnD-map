import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PLAN_SCHEMA } from '../../server/ai';
import { createApp } from '../../server/app';
import { OllamaAi, parseJson } from '../../server/ollama';
import { buildMapFromPlan } from '../../shared/build';
import type { ServerMsg } from '../../shared/protocol';

const req = { reqId: '1', prompt: 'A goblin cave', theme: 'cave' as const, width: 40, height: 30, placeCreatures: false };
const PLAN = { name: 'Goblin Warren', rooms: [{ id: 'a', name: 'Den', shape: 'cave', x: 4, y: 4, w: 10, h: 8, terrain: 'floor', note: '' }], connections: [], patches: [], objects: [], creatures: [] };

type Handler = (path: string, body: Record<string, unknown>, res: http.ServerResponse) => void;
const servers: http.Server[] = [];
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) s.close();
  for (const c of cleanups.splice(0)) await c();
});

/** A stand-in for Ollama's HTTP API. */
async function fakeOllama(h: Handler, models = ['qwen2.5:7b']) {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  const s = http.createServer((rq, res) => {
    let raw = '';
    rq.on('data', (d) => (raw += d));
    rq.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ path: rq.url!, body });
      if (rq.url === '/api/tags') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: models.map((name) => ({ name, model: name })) })); }
      h(rq.url!, body, res);
    });
  });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, seen };
}
const reply = (res: http.ServerResponse, content: string) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ message: { role: 'assistant', content } })); };

describe('Ollama provider', () => {
  it('reports whether Ollama is running and has the model', async () => {
    const { url } = await fakeOllama(() => {});
    expect(await new OllamaAi({ url }).info()).toMatchObject({ kind: 'ollama', reachable: true, hasModel: true, ready: true });
    expect(await new OllamaAi({ url, model: 'llama3.1:8b' }).info()).toMatchObject({ reachable: true, hasModel: false, ready: false });
    expect(await new OllamaAi({ url: 'http://127.0.0.1:1' }).info()).toMatchObject({ reachable: false, ready: false });
  });

  it('asks for the plan schema with a big enough context, and returns the plan', async () => {
    const { url, seen } = await fakeOllama((p, _b, res) => reply(res, `Sure! Here it is:\n${JSON.stringify(PLAN)}\nEnjoy.`));
    const plan = await new OllamaAi({ url }).generate(req);
    expect(plan).toEqual(PLAN);
    const chat = seen.find((s) => s.path === '/api/chat')!.body;
    expect(chat.format).toEqual(PLAN_SCHEMA);
    expect(chat.stream).toBe(false);
    expect((chat.options as { num_ctx: number }).num_ctx).toBeGreaterThanOrEqual(8192);
    expect(JSON.stringify(chat.messages)).toContain('A goblin cave');
    expect(buildMapFromPlan(plan, { width: 40, height: 30, theme: 'cave', seed: 'x' }).name).toBe('Goblin Warren');
  });

  it('retries once on broken JSON, then gives up', async () => {
    let n = 0;
    const ok = await fakeOllama((_p, _b, res) => reply(res, n++ === 0 ? '{"name": "Half' : JSON.stringify(PLAN)));
    expect(await new OllamaAi({ url: ok.url }).generate(req)).toEqual(PLAN);
    expect(ok.seen.filter((s) => s.path === '/api/chat')).toHaveLength(2);
    const bad = await fakeOllama((_p, _b, res) => reply(res, 'no json here'));
    await expect(new OllamaAi({ url: bad.url }).generate(req)).rejects.toThrow(/invalid JSON/);
  });

  it('explains a missing model or a stopped Ollama', async () => {
    const { url } = await fakeOllama((_p, _b, res) => { res.writeHead(404); res.end('model not found'); });
    await expect(new OllamaAi({ url }).generate(req)).rejects.toThrow(/isn't downloaded/);
    await expect(new OllamaAi({ url: 'http://127.0.0.1:1' }).generate(req)).rejects.toThrow(/not running/);
  });

  it('streams download progress, and reports errors', async () => {
    const { url } = await fakeOllama((p, _b, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.write('{"status":"pulling manifest"}\n');
      res.write('{"status":"downloading","total":1000,"completed":400}\n{"status":"downl');
      setTimeout(() => { res.write('oading","total":1000,"completed":1000}\n{"status":"success"}\n'); res.end(); }, 20);
    });
    const seen: number[] = [];
    await new OllamaAi({ url }).pull((pr) => seen.push(pr.completed));
    expect(seen).toEqual([0, 400, 1000, 0]);
    const broken = await fakeOllama((_p, _b, res) => { res.writeHead(200); res.end('{"error":"pull model manifest: file does not exist"}\n'); });
    await expect(new OllamaAi({ url: broken.url }).pull(() => {})).rejects.toThrow(/does not exist/);
  });

  it('pulls JSON out of chatty replies', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('nothing')).toBeUndefined();
  });

  it('lets the DM download the model and see progress', async () => {
    let pulled = false;
    const models: string[] = [];
    const fake = await fakeOllama((p, _b, res) => {
      res.writeHead(200);
      res.write('{"status":"downloading","total":10,"completed":5}\n');
      pulled = true; models.push('qwen2.5:7b');
      res.end('{"status":"success"}\n');
    }, models);
    const dir = mkdtempSync(path.join(tmpdir(), 'dndmap-ollama-'));
    const app = await createApp({ dataDir: dir, broadcastMs: 5, saveDebounceMs: 5, ai: new OllamaAi({ url: fake.url }) });
    cleanups.push(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
    await new Promise<void>((r) => app.server.listen(0, r));
    const port = (app.server.address() as { port: number }).port;
    const g = await (await fetch(`http://127.0.0.1:${port}/api/games`, { method: 'POST', body: '{}' })).json() as { code: string; dmSecret: string };
    const msgs: ServerMsg[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'join', code: g.code, role: 'dm', secret: g.dmSecret }));
    const until = async (pred: (m: ServerMsg) => boolean) => { for (let i = 0; i < 100; i++) { const m = msgs.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timeout'); };
    const first = await until((m) => m.type === 'ai.info') as Extract<ServerMsg, { type: 'ai.info' }>;
    expect(first.ai).toMatchObject({ kind: 'ollama', reachable: true, hasModel: false, ready: false });
    // Asking for an AI map now explains why it can't.
    ws.send(JSON.stringify({ type: 'ai', reqId: 'r1', prompt: 'x', theme: 'cave', width: 40, height: 30, placeCreatures: false }));
    expect(((await until((m) => m.type === 'ai.error')) as { message: string }).message).toMatch(/isn’t downloaded/);
    ws.send(JSON.stringify({ type: 'ai.pull' }));
    await until((m) => m.type === 'ai.progress' && !!m.done);
    expect(pulled).toBe(true);
    const ready = await until((m) => m.type === 'ai.info' && !!m.ai?.ready) as Extract<ServerMsg, { type: 'ai.info' }>;
    expect(ready.ai).toMatchObject({ hasModel: true, ready: true });
    ws.close();
  });
});
