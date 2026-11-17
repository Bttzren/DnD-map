import { describe, expect, it } from 'vitest';
import { makeAi, PLAN_SCHEMA, type MessagesClient } from '../../server/ai';
import { buildMapFromPlan } from '../../shared/build';

const req = { reqId: '1', prompt: 'A flooded crypt with three chambers', theme: 'crypt' as const, width: 40, height: 30, placeCreatures: false };

function fake(response: unknown, seen: Record<string, unknown>[] = []): MessagesClient {
  return { beta: { messages: { create: async (body) => { seen.push(body); return response; } } } };
}

describe('makeAi', () => {
  it('is off without a key or client', () => {
    expect(makeAi({ apiKey: '' })).toBeNull();
    expect(makeAi({})).toBeNull();
  });

  it('returns the parsed plan and sends a structured-output request', async () => {
    const plan = { name: 'Drowned Crypt', rooms: [{ id: 'a', name: 'Nave', shape: 'rect', x: 4, y: 4, w: 8, h: 6, terrain: 'floor', note: '' }], connections: [], patches: [], objects: [], creatures: [] };
    const seen: Record<string, unknown>[] = [];
    const ai = makeAi({ client: fake({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(plan) }] }, seen) })!;
    const out = await ai.generate(req);
    expect(out).toEqual(plan);
    expect(seen[0].model).toBe('claude-opus-5-5');
    expect((seen[0].output_config as { format: { schema: unknown } }).format.schema).toBe(PLAN_SCHEMA);
    expect(String((seen[0].messages as { content: string }[])[0].content)).toContain('flooded crypt');
    expect(seen[0].tool_choice).toBeUndefined();
    expect(buildMapFromPlan(out, { width: 40, height: 30, theme: 'crypt', seed: 'x' }).name).toBe('Drowned Crypt');
  });

  it('honours a model override', async () => {
    const seen: Record<string, unknown>[] = [];
    await makeAi({ model: 'claude-sonnet-5-5', client: fake({ content: [{ type: 'text', text: '{}' }] }, seen) })!.generate(req);
    expect(seen[0].model).toBe('claude-sonnet-5-5');
  });

  it('throws on refusal or empty output', async () => {
    await expect(makeAi({ client: fake({ stop_reason: 'refusal', content: [] }) })!.generate(req)).rejects.toThrow(/declined/);
    await expect(makeAi({ client: fake({ stop_reason: 'max_tokens', content: [] }) })!.generate(req)).rejects.toThrow(/No plan/);
  });
});
