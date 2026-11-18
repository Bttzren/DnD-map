# DnD Map

Build battle maps in seconds and put them on every player's screen, live.

The DM generates a map (free and instant, or described to an AI), tweaks it
by hand, and runs the session: moving tokens, revealing rooms through fog of
war, tracking initiative and HP. Players join from a phone or laptop with a
code or QR, with no account, and see the map update as the DM plays. They
can measure distances themselves, and they never receive anything the DM
hasn't revealed.

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run build
npm start
```

Open <http://localhost:3000>, press **Start a new game**, and share the code.

### Playing in person

Run it on your laptop. When it starts it prints addresses like
`http://192.168.1.20:3000`. Players on the same wifi open that address (or
scan the QR on the **Invite** screen) and enter the code.

### Playing online

Host it anywhere that runs Node. The repo includes a `render.yaml`, so on
[Render](https://render.com) you can create a **Blueprint** from this repo
and it is set up for you on the free plan.

Free hosts sleep when idle (the first visit takes about 30 seconds to wake)
and wipe their disk when they restart. That's fine: the DM's browser keeps a
copy of the game and hands it back automatically, and players reconnect on
their own.

## Settings

All optional, set as environment variables.

| Variable | What it does |
|---|---|
| `PORT` | Port to listen on. Default `3000`. |
| `ANTHROPIC_API_KEY` | Turns on **Describe it to the AI**. Without it, the free built-in generator still works. |
| `AI_MODEL` | Claude model for AI maps. Default `claude-opus-5-5`. |
| `HOST_PASSWORD` | If set, starting a new game requires this password, so strangers can't use your server or your AI credit. Players never need it. |
| `SECRET_KEY` | Any long random string. Lets the server check a DM's key after it has lost its disk. Set this when hosting online. (`HOST_PASSWORD` works as a fallback.) |
| `DATA_DIR` | Where games are saved. Default `./data`. Games untouched for 30 days are deleted. |

AI maps are limited to 5 per minute per game. Each one is a single Claude
request, billed to your API key.

## Running a session

**Make a map.** In **Generate**, pick a setting (dungeon, caves, crypt,
forest, tavern, sewers), a size and how many rooms, and press generate. Tick
*Add monsters* for a ready encounter and *Bring the party* to carry player
tokens over. Or describe what you want to the AI ("a flooded crypt with three
burial chambers and a secret vault behind the altar"). You can also start
blank and paint.

**Fix it up.** The tool rail on the left:

| Key | Tool | |
|---|---|---|
| `V` | Select & move | Drag tokens (shift-click for groups), click doors to open/close, arrows nudge |
| `B` | Paint terrain | Walls appear around new floor automatically. Alt-click picks a terrain |
| `D` | Doors | Click to add; click again to cycle closed, open, secret, gone |
| `O` | Objects | Chests, tables, pillars, altars, traps (can be hidden) and more |
| `F` | Fog of war | Reveal or hide a whole room in one click, or brush it |
| `R` | Measure | Drag to measure; starting on a token measures from it |
| `T` | Spell areas | Circles, cones, lines and squares that show the squares they cover |
| `P` | Draw | Freehand, visible to players or just you |
| `L` | Label | Text on the map |
| `G` | Ping | Flash a spot for everyone; shift-click also pulls their view there |

Also: `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo, `H` hides the selected token,
`Delete` removes it, `N` advances initiative, `0` fits the map, `[` and `]`
change the brush, `Tab` toggles the side panel, and holding `Space` pans.

**Run it.**

- **Tokens:** a library of monsters, NPCs and party classes with HP and AC,
  added in batches. Add them hidden for an ambush. Click a token for its
  inspector: damage and heal, conditions, AC, notes only you see, and what
  players see of its health (numbers, a bar, a word like *bloodied*, or
  nothing).
- **Pictures:** give any token a picture from your files (in its inspector,
  **Upload**). Added a batch of goblins? Picture one, then **Use for the other
  goblins**.
- **Initiative:** add the party and foes, roll for monsters, and press `N` for
  each turn. The active creature glows on every screen. Players only see
  creatures they can see.
- **Map:** keep several maps. Edit one privately while players look at
  another, then press **Show this map**. Weather (rain, snow, mist, embers,
  darkness), the diagonal rule (5 ft, 5/10, or exact), grid strength, moving
  the party between maps, and import/export.
- **Table:** who's connected, blank everyone's screen with a message, show a
  banner ("Roll for initiative!"), or make players follow your view.

## What players see

Players get the map, full screen, and little else:

- **Turn order** while combat is running (and you've made it visible): a strip
  across the top on phones, a column on the right on bigger screens. The
  current turn glows.
- **Party chips** along the bottom: each player character's portrait, name,
  health (shown the way you chose per token), conditions, and whether
  they're down. The chip glows on that character's turn, and tapping it
  centres the map on them.
- Three small buttons: measure a distance, fit the map to the screen, and
  📷 set your character's picture (take a photo, or pick one from the camera
  roll or files). Tapping a token shows its name and health.
- **Press and hold** the map to point at a spot: everyone sees a ping in your
  character's colour with your name on it.

Players can only change pictures on party tokens they can see, never on
monsters. Pictures are shrunk to a small square on the device before they're
sent, and saved with the game.

## What players can't see

The server builds each player's view and strips anything not revealed before
it leaves the server, so it can't be found by inspecting the page:
unrevealed areas, hidden tokens and traps, secret doors (they look like
wall), room names, your notes, and hidden drawings and labels. Monsters
standing in fog aren't sent at all.

## Map art

Maps are drawn with real textures (stone, wood, cobbles, grass, water,
lava) from [Poly Haven](https://polyhaven.com), which are CC0 (public
domain). They live in `public/textures/`, with the list of sources in
`public/textures/CREDITS.md`. To change them, edit and run
`scripts/fetch-textures.py`. If the textures can't load, maps fall back to
plain drawn colours.

## Development

```bash
npm run dev        # server and client with live reload on http://localhost:5173
npm test           # unit and server tests
npm run typecheck
npm run e2e        # end-to-end: real server, a DM browser and two players
```

`npm run e2e` needs Playwright with Chromium
(`npm i -D playwright && npx playwright install chromium`).

```
shared/   map model, generators, map builder, op reducer, player-view filter
server/   HTTP + WebSocket server, game storage, AI generator
client/   DM and player screens, canvas renderer
tests/    unit and server tests
scripts/  end-to-end test, texture fetcher
public/   textures
docs/     design and implementation plan
```
