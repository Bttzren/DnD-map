// End-to-end check: a real server, one DM browser and two player browsers.
// Run with `npm run e2e` (builds first). Needs Playwright with Chromium.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch {
  console.error('Playwright is not installed. Install it with: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}
const { chromium, devices } = playwright;

const PORT = 4123 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const SECRET = 'E2E-HIDDEN-ASSASSIN';
let dataDir = mkdtempSync(path.join(tmpdir(), 'dndmap-e2e-'));
let server;
let failures = 0;

function startServer() {
  server = spawn(process.execPath, ['dist/server.mjs'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SECRET_KEY: 'e2e-key', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return waitFor(async () => (await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)), 'server up', 8000);
}
async function stopServer() {
  if (!server) return;
  const done = new Promise((r) => server.once('exit', r));
  server.kill('SIGKILL');
  await done;
}

async function waitFor(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`Timed out waiting for: ${what}`);
}
function check(ok, what) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${what}`);
  if (!ok) failures++;
}

const errors = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(`${who}: ${m.text()}`); });
};
const frames = [];
const captureFrames = (page) => page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
const cellToPage = (page, global, x, y) => page.evaluate(([g, cx, cy]) => {
  const { view } = window[g]; const s = view.toScreen(cx, cy); const r = view.canvas.getBoundingClientRect();
  return [s.x + r.left, s.y + r.top];
}, [global, x, y]);

try {
  await startServer();
  console.log(`Server on ${BASE}`);
  const browser = await chromium.launch();

  // DM starts a game and generates a map.
  const dm = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  watch(dm, 'DM');
  await dm.goto(BASE);
  await dm.getByRole('button', { name: /Start a new game/ }).click();
  await dm.waitForURL(/\/dm\//);
  const code = dm.url().split('/dm/')[1];
  await dm.getByLabel('Seed').fill('e2e-seed').catch(() => dm.locator('input.input.sm').first().fill('e2e-seed'));
  await dm.getByRole('button', { name: /Generate dungeon/ }).click();
  await waitFor(() => dm.evaluate(() => !!window.__dm.ctl.map), 'map generated');
  console.log(`Game ${code}`);

  // Add a visible fighter and a hidden assassin next to it, and reveal the first room.
  const setup = await dm.evaluate((secret) => {
    const { ctl } = window.__dm; const m = ctl.map; const r = m.rooms[0];
    const free = r.cells.filter((c) => ['floor', 'wood', 'tile', 'dirt', 'grass', 'sand'].includes(m.terrain[c]) && !m.objects.some((o) => o.y * m.width + o.x === c));
    const at = (c) => ({ x: c % m.width, y: Math.floor(c / m.width) });
    const hero = { id: 'tok_hero', name: 'Fighter', label: 'F', color: '#3b82f6', size: 1, kind: 'player', ...at(free[0]), hidden: false, hp: 20, maxHp: 20, ac: 16, conditions: [], note: '', down: false, hpVisibility: 'exact' };
    const sneak = { ...hero, id: 'tok_sneak', name: secret, kind: 'enemy', ...at(free[1]), hidden: true, note: secret };
    ctl.dispatch({ t: 'item.put', mapId: m.id, coll: 'tokens', item: hero });
    ctl.dispatch({ t: 'item.put', mapId: m.id, coll: 'tokens', item: sneak });
    ctl.dispatch({ t: 'fog.set', mapId: m.id, cells: r.cells, revealed: true });
    return { hero, mapId: m.id, free: free.slice(2, 6).map(at) };
  }, SECRET);

  // Two players: a laptop and a phone.
  const players = [];
  for (const [name, ctx] of [['Ana', { viewport: { width: 1280, height: 800 } }], ['Ben', devices['iPhone 13']]]) {
    const page = await (await browser.newContext(ctx)).newPage();
    watch(page, name); captureFrames(page);
    await page.goto(`${BASE}/play/${code.toLowerCase()}`);
    await page.getByPlaceholder("Your character's name").fill(name);
    await page.getByRole('button', { name: 'Join' }).click();
    players.push(page);
  }
  for (const p of players) await waitFor(() => p.evaluate(() => !!window.__pl.view.map), 'player sees map');
  check(true, 'two players joined with a lowercase code and see the map');
  await waitFor(() => dm.evaluate(() => window.__dm.ctl.state.players.length === 2), 'DM sees two watchers');
  check(true, 'DM sees both players at the table');

  // DM drags the fighter with the mouse.
  const target = setup.free[0];
  const from = await cellToPage(dm, '__dm', setup.hero.x + 0.5, setup.hero.y + 0.5);
  const to = await cellToPage(dm, '__dm', target.x + 0.5, target.y + 0.5);
  await dm.keyboard.press('v');
  await dm.mouse.move(from[0], from[1]); await dm.mouse.down();
  await dm.mouse.move(to[0], to[1], { steps: 8 }); await dm.mouse.up();
  for (const p of players) {
    await waitFor(() => p.evaluate(([x, y]) => { const t = window.__pl.view.map.tokens.find((t) => t.name === 'Fighter'); return t && t.x === x && t.y === y; }, [target.x, target.y]), 'player sees move');
  }
  check(true, 'a mouse drag on the DM screen moves the token on both player screens');
  check(await players[0].evaluate(() => window.__pl.view.map.tokens.length === 1), 'players see only the visible token');

  // Undo the move.
  await dm.keyboard.press('Control+z');
  await waitFor(() => players[0].evaluate(([x, y]) => { const t = window.__pl.view.map.tokens.find((t) => t.name === 'Fighter'); return t && t.x === x && t.y === y; }, [setup.hero.x, setup.hero.y]), 'undo reaches players');
  check(true, 'Ctrl+Z undoes the move for everyone');

  // A second map goes live.
  await dm.getByRole('button', { name: /Generate dungeon/ }).click();
  const second = await dm.evaluate(() => window.__dm.ctl.map.name);
  await dm.getByRole('button', { name: 'Show this map' }).click();
  for (const p of players) await waitFor(() => p.evaluate((n) => window.__pl.view.map?.name === n, second), 'players switch maps');
  check(true, `switching the live map moves players to "${second}"`);
  await dm.getByRole('tab', { name: 'Map' }).click();
  await dm.locator('.item', { hasText: /.+/ }).first().locator('button', { hasText: 'Go live' }).click();
  for (const p of players) await waitFor(() => p.evaluate((id) => window.__pl.view.map?.id === id, setup.mapId), 'players back on first map');

  // Server restarts with an empty disk; the DM's browser restores the game.
  await new Promise((r) => setTimeout(r, 1200)); // let the browser backup land
  await stopServer();
  rmSync(dataDir, { recursive: true, force: true });
  dataDir = mkdtempSync(path.join(tmpdir(), 'dndmap-e2e-'));
  await startServer();
  await waitFor(() => dm.evaluate(() => window.__dm.ctl.state.status === 'open' && window.__dm.ctl.state.game?.maps.length === 2), 'DM reconnected with restored game', 15000);
  for (const p of players) await waitFor(() => p.evaluate((id) => window.__pl.view.map?.id === id, setup.mapId), 'players back after restart', 15000);
  check(true, 'after a server restart with an empty disk, the DM browser restores the game and players see it again');

  // Nothing secret ever reached a player.
  const leaked = frames.filter((f) => f.includes(SECRET));
  check(frames.length > 5 && leaked.length === 0, `no player WebSocket frame (of ${frames.length}) contained the hidden token`);
  check(!frames.some((f) => /"rooms"|"note"/.test(f)), 'no player frame contained room names or DM notes');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
} catch (err) {
  console.error('  ✗', err.message);
  failures++;
} finally {
  await stopServer();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll end-to-end checks passed');
process.exit(failures ? 1 : 0);
