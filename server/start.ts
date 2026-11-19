// Starting the server, shared by `npm start` (index.ts) and the desktop app.
import { makeAi } from './ai';
import { createApp } from './app';
import { lanAddresses } from './lan';
import { OllamaAi } from './ollama';

export interface StartOptions {
  /** Port to try first; the next few are tried if it's taken (unless strictPort). */
  port: number;
  strictPort?: boolean;
  dataDir: string;
  staticDir: string;
  hostPassword?: string | null;
  secretKey?: string | null;
  anthropicKey?: string | null;
  aiModel?: string | null;
  ollamaUrl?: string | null;
  ollamaModel?: string | null;
  log?: (line: string) => void;
}

export async function startServer(o: StartOptions) {
  const log = o.log ?? ((l: string) => console.log(l));
  // Claude when there's an API key; otherwise a free local model through Ollama, if it's running.
  const ai = makeAi({ apiKey: o.anthropicKey, model: o.aiModel })
    ?? (o.ollamaUrl === 'off' ? null : new OllamaAi({ url: o.ollamaUrl, model: o.ollamaModel }));
  const app = await createApp({ dataDir: o.dataDir, hostPassword: o.hostPassword || null, secretKey: o.secretKey || null, staticDir: o.staticDir, ai });

  const listen = (port: number) => new Promise<number>((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException) => { app.server.off('listening', onOk); reject(e); };
    const onOk = () => { app.server.off('error', onError); resolve((app.server.address() as { port: number }).port); };
    app.server.once('error', onError);
    app.server.once('listening', onOk);
    app.server.listen(port);
  });
  let port = 0;
  for (let p = o.port, tries = 0; ; p++, tries++) {
    try { port = await listen(p); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || o.strictPort || tries >= 20) throw e;
    }
  }

  log(`DnD Map running on http://localhost:${port}`);
  for (const ip of lanAddresses()) log(`  Players on your wifi: http://${ip}:${port}`);
  log(`  Host password: ${o.hostPassword ? 'required to start games' : 'not set (anyone can start a game)'}`);
  if (!ai) log('  AI maps: off');
  else void ai.info?.().then((i) => log(`  AI maps: ${i.kind === 'claude' ? `Claude (${i.model})`
    : i.ready ? `local model ${i.model} through Ollama` : i.reachable ? `Ollama found; download ${i.model} from the DM screen` : 'off (install Ollama for free local AI, or set ANTHROPIC_API_KEY)'}`));

  return { port, url: `http://localhost:${port}`, close: () => app.close() };
}
