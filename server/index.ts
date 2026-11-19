import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './start';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

const server = await startServer({
  port: Number(env.PORT) || 3000,
  // Hosts like Render hand us a port that must be used as is.
  strictPort: !!env.PORT,
  dataDir: env.DATA_DIR ?? path.resolve(process.cwd(), 'data'),
  staticDir: env.STATIC_DIR ?? path.resolve(here, here.endsWith('dist') ? 'public' : '../dist/public'),
  hostPassword: env.HOST_PASSWORD,
  secretKey: env.SECRET_KEY,
  anthropicKey: env.ANTHROPIC_API_KEY,
  aiModel: env.AI_MODEL,
  ollamaUrl: env.OLLAMA_URL,
  ollamaModel: env.OLLAMA_MODEL,
});

const stop = async () => {
  console.log('Saving games and shutting down…');
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
