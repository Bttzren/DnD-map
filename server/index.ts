import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAi } from './ai';
import { createApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 3000;
const staticDir = process.env.STATIC_DIR ?? path.resolve(here, here.endsWith('dist') ? 'public' : '../dist/public');

const ai = makeAi({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL });

const app = await createApp({
  dataDir: process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'),
  hostPassword: process.env.HOST_PASSWORD || null,
  secretKey: process.env.SECRET_KEY || null,
  staticDir,
  ai,
});

app.server.listen(port, () => {
  console.log(`DnD Map running on http://localhost:${port}`);
  const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
  for (const ip of lan) console.log(`  Players on your wifi: http://${ip}:${port}`);
  console.log(`  AI generator: ${ai ? 'on' : 'off (set ANTHROPIC_API_KEY to enable)'}`);
  console.log(`  Host password: ${process.env.HOST_PASSWORD ? 'required to start games' : 'not set (anyone can start a game)'}`);
});

const stop = async () => {
  console.log('Saving games and shutting down…');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
