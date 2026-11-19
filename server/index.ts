import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAi } from './ai';
import { OllamaAi } from './ollama';
import { createApp } from './app';
import { lanAddresses } from './lan';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;
const staticDir = process.env.STATIC_DIR ?? path.resolve(here, here.endsWith('dist') ? 'public' : '../dist/public');

// Claude when there's an API key; otherwise a free local model through Ollama, if it's running.
const ai = makeAi({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL })
  ?? (process.env.OLLAMA_URL === 'off' ? null : new OllamaAi({ url: process.env.OLLAMA_URL, model: process.env.OLLAMA_MODEL }));

const app = await createApp({
  dataDir: process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'),
  hostPassword: process.env.HOST_PASSWORD || null,
  secretKey: process.env.SECRET_KEY || null,
  staticDir,
  ai,
});

app.server.listen(port, () => {
  console.log(`DnD Map running on http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`  Players on your wifi: http://${ip}:${port}`);
  void ai?.info?.().then((i) => console.log(`  AI maps: ${i.kind === 'claude' ? `Claude (${i.model})`
    : i.ready ? `local model ${i.model} through Ollama` : i.reachable ? `Ollama found; download ${i.model} from the DM screen` : 'off (install Ollama for free local AI, or set ANTHROPIC_API_KEY)'}`));
  if (!ai) console.log('  AI maps: off');
  console.log(`  Host password: ${process.env.HOST_PASSWORD ? 'required to start games' : 'not set (anyone can start a game)'}`);
});

const stop = async () => {
  console.log('Saving games and shutting down…');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
