// Free, private AI maps from a model running on this computer with Ollama
// (https://ollama.com). Same job as the Claude provider: ask for a layout
// plan as JSON, which the map builder then carves and checks.
import type { AiRequest } from '../shared/protocol';
import { PLAN_SCHEMA, systemPrompt, userPrompt } from './ai';
import type { AiInfo, AiProvider, PullProgress } from './hub';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
/** A small model that's good at following a JSON schema. Change with OLLAMA_MODEL. */
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5:7b';

type Fetch = typeof fetch;

/** Extra guidance for small local models, which follow a worked example better than rules. */
const EXAMPLE = JSON.stringify({
  name: 'The Sunken Shrine',
  rooms: [
    { id: 'a', name: 'Flooded Entry', shape: 'rect', x: 3, y: 4, w: 7, h: 6, terrain: 'floor', note: 'Knee-deep water hides a pit.' },
    { id: 'b', name: 'Shrine', shape: 'rect', x: 14, y: 3, w: 9, h: 8, terrain: 'floor', note: 'An altar to a drowned god.' },
  ],
  connections: [{ from: 'a', to: 'b', door: 'closed' }],
  patches: [{ terrain: 'water', x: 4, y: 6, w: 4, h: 3, shape: 'blob' }],
  objects: [{ kind: 'altar', room: 'b', hidden: false }, { kind: 'trap', room: 'a', hidden: true }],
  creatures: [],
});

export class OllamaAi implements AiProvider {
  readonly kind = 'ollama' as const;
  private cache: { at: number; info: AiInfo } | null = null;
  private pulling: Promise<void> | null = null;
  private fetch: Fetch;

  constructor(private o: { url?: string | null; model?: string | null; fetch?: Fetch; timeoutMs?: number }) {
    this.fetch = o.fetch ?? fetch;
  }

  get url() { return (this.o.url || DEFAULT_OLLAMA_URL).replace(/\/+$/, ''); }
  get model() { return this.o.model || DEFAULT_OLLAMA_MODEL; }

  /** Is Ollama running, and does it have the model? Checked at most every few seconds. */
  async info(fresh = false): Promise<AiInfo> {
    if (!fresh && this.cache && Date.now() - this.cache.at < 5000) return this.cache.info;
    let info: AiInfo = { kind: 'ollama', model: this.model, ready: false, reachable: false, hasModel: false, pulling: !!this.pulling };
    try {
      const r = await this.fetch(`${this.url}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (r.ok) {
        const tags = (await r.json()) as { models?: { name?: string; model?: string }[] };
        const want = this.model.includes(':') ? this.model : `${this.model}:latest`;
        const hasModel = (tags.models ?? []).some((m) => m.name === want || m.model === want || m.name === this.model);
        info = { ...info, reachable: true, hasModel, ready: hasModel && !this.pulling };
      }
    } catch { /* not running */ }
    this.cache = { at: Date.now(), info };
    return info;
  }

  async generate(req: AiRequest): Promise<unknown> {
    const messages = [
      { role: 'system', content: `${systemPrompt()}\n\nReply with only a JSON object in exactly this shape (this is an example, not the answer):\n${EXAMPLE}` },
      { role: 'user', content: userPrompt(req) },
    ];
    let lastError = '';
    // Small models occasionally produce broken JSON; one retry usually fixes it.
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await this.fetch(`${this.url}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 8 * 60_000),
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: PLAN_SCHEMA,
          keep_alive: '15m',
          // The default context is small and silently cuts prompts off.
          options: { num_ctx: 8192, num_predict: 3072, temperature: attempt ? 0.3 : 0.7 },
          messages: attempt ? [...messages, { role: 'user', content: 'Your last reply was not valid JSON. Reply again with only the JSON object.' }] : messages,
        }),
      }).catch((e: Error) => { throw new Error(e.name === 'TimeoutError' ? 'The local AI took too long.' : 'Ollama is not running on this computer.'); });
      if (r.status === 404) throw new Error(`The local AI model "${this.model}" isn't downloaded yet.`);
      if (!r.ok) throw new Error(`Ollama error ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const body = (await r.json()) as { message?: { content?: string } };
      const plan = parseJson(body.message?.content ?? '');
      if (plan !== undefined) return plan;
      lastError = 'invalid JSON';
    }
    throw new Error(`The local AI returned ${lastError}.`);
  }

  /** Download the model through Ollama, reporting progress. One download at a time. */
  pull(onProgress: (p: PullProgress) => void): Promise<void> {
    if (this.pulling) return this.pulling;
    this.cache = null;
    this.pulling = (async () => {
      const r = await this.fetch(`${this.url}/api/pull`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, stream: true }),
      });
      if (!r.ok || !r.body) throw new Error(`Ollama couldn't start the download (${r.status}).`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let m: { status?: string; total?: number; completed?: number; error?: string };
          try { m = JSON.parse(line); } catch { continue; }
          if (m.error) throw new Error(m.error);
          onProgress({ status: String(m.status ?? ''), total: Number(m.total) || 0, completed: Number(m.completed) || 0 });
        }
        if (done) break;
      }
    })().finally(() => { this.pulling = null; this.cache = null; });
    return this.pulling;
  }
}

/** The JSON object in a reply, ignoring any chatter around it. */
export function parseJson(text: string): unknown {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return undefined;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return undefined; }
}
