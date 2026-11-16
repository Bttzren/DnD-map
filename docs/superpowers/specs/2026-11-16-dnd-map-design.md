# DnD Map: design

Date: 2026-11-16
Status: awaiting approval

## Intent

A web app for a Dungeon Master to build encounter maps quickly, with AI
doing the layout work, and show them live to players on their own
devices. The DM runs the whole board. Players watch, and can always tell
how far apart things are.

The why: prepping a battle map by hand is slow, and improvising one
mid-session is slower. The DM should be able to type one sentence, get a
usable map in seconds, fix what's off, and have it on every player's
screen.

## What the owner decided

- The DM moves everything. Players never move tokens.
- Players can see distance (how far or close things are).
- AI lays the map out as structured data and the app draws it. AI does
  not paint a picture.
- Players join the DM's game from their own devices.
- One small server serves the app, keeps everyone in sync and holds the
  AI key.

Everything else in this document is the designer's call, open to
correction.

## Goals

1. DM types a description and gets a playable gridded map in seconds.
2. A free built-in random generator works with no AI key at all.
3. DM can fix a generated map by hand: paint terrain, add or remove
   doors and objects.
4. Players join with a link or short room code, in a browser, with no
   account and no install. It works on a phone.
5. Players see the map, tokens and a 5 ft grid, live, and can measure
   distance themselves.
6. DM controls what players can see (fog of war, hidden tokens).
7. DM can prep several maps and choose which one players are looking at.
8. It runs free: on a free hosting tier, or on the DM's laptop for
   in-person games.

## Non-goals

- Players moving tokens or editing anything.
- Dice, character sheets, initiative tracking, chat, voice.
- Accounts, logins, friends lists.
- World or region maps.
- AI-painted map images.
- Automatic line of sight or dynamic lighting.

## Anti-goals

These make it a failure even if everything else works:

- A player can see something the DM has hidden, including by inspecting
  what the browser received. Hidden data never leaves the server.
- The app is useless without an AI key.
- The DM loses a map mid-session because a server restarted.
- A stranger who finds the site can spend the DM's AI credit.
- Joining takes more than opening a link.

## Constraints

- The repo is empty apart from a README. Nothing to stay compatible with.
- Free hosting tiers sleep when idle and wipe their disk on restart, so
  the server's disk cannot be the only copy of a map.
- AI generation needs an API key the owner supplies. It is billed
  separately from anything else.
- Players are often on phones and sometimes on restrictive wifi. Plain
  HTTPS and WebSockets only.

## Approaches

Three ways to build "players join" were considered:

- **A. Small server (chosen).** One Node process serves the app, syncs
  rooms over WebSockets and calls the AI. Works in person and online,
  keeps the AI key off browsers, and lets the server filter what players
  receive. Cost: free hosts take about 30 seconds to wake after idling.
- **B. Browser to browser.** The DM's tab hosts and players connect
  directly. No server to run, but often blocked on school and strict
  networks, the room dies with the tab, the AI key sits in a browser,
  and hidden data would have to be filtered by the DM's own tab.
- **C. Rented realtime backend.** A third-party service does the sync.
  Free tier, but needs an account there, ties the app to that service,
  and still needs somewhere private to keep the AI key.

The owner picked A.

## How it works

### The pieces

```
shared/   map and message types, distance maths, player-view filter
server/   HTTP + WebSocket server, room store, generators, AI call
client/   DM screen and player screen, canvas renderer
```

TypeScript throughout. One `npm run build` and `npm start` produces a
single process that serves the built client, the API and the WebSocket.

### The map

A map is a grid of square cells, each 5 ft. Default 40 x 30, maximum
80 x 80.

- Each cell has one terrain: void (solid rock, nothing there), floor,
  wall, water, deep water, lava, grass, dirt, trees, rubble (difficult
  terrain), pit.
- Doors sit on cells and are open, closed or secret. A secret door looks
  like wall to players until the DM reveals it.
- Objects sit on cells: stairs, chest, table, pillar, altar, statue,
  bed, barrel, campfire, trap. A trap can be hidden from players.
- Rooms are named areas with a DM-only note ("3 skeletons, one holds the
  key"). Players never receive room names or notes.
- A theme (dungeon, cave, crypt, forest, tavern, sewer) picks the
  colours and textures.
- A fog layer records which cells players have been shown.

### Making a map

Two generators feed one shared step that turns a layout plan into cells.

**Layout plan.** A list of rooms (rectangles or blobs with a position
and size), connections between rooms, doors, terrain patches, objects
and notes. The server checks every plan: it clamps things to the map
edges, drops anything invalid, and makes sure every room can be reached,
carving a corridor if one can't.

**Built-in generator (free).** Picks a plan itself from a theme, a size
and a seed. Three styles: rooms and corridors (dungeon, crypt, sewer),
organic caves, and outdoor clearings (forest). The same seed gives the
same map.

**AI generator.** Sends the DM's sentence, theme and size to the Claude
API and asks for a layout plan in a fixed structure. The plan goes
through the same checks, so a sloppy answer still gives a valid map. If
no key is configured, the AI box is greyed out with a one-line
explanation and the built-in generator still works. The key lives only
in the server's environment.

**By hand.** After generating, the DM can paint terrain with a brush,
place and remove doors and objects, rename rooms and edit notes, with
undo.

### Tokens

A token has a name, a colour, a short label or emoji, a size (1x1 up to
4x4) and a kind (player, ally, enemy, neutral). The DM drags tokens and
they snap to the grid. A token can be marked hidden, which means only
the DM sees it. A token standing on a cell players haven't been shown is
also not sent to them.

### Fog of war

New maps start fully hidden. The DM reveals with a brush, by clicking a
room to reveal all of it, or with "reveal all". The DM can hide areas
again. On the DM's screen fog is a translucent tint. On a player's
screen unrevealed cells are solid black, and the server sends nothing
about them.

### Distance

- The grid is always visible, and a scale marker shows one square is
  5 ft.
- Players and the DM can tap one spot and then another to get a ruler
  showing the distance in feet and squares. Tapping a token measures
  from that token.
- Diagonals count as 5 ft, the standard D&D 5e rule.
- A player's ruler is only on that player's own screen.

### Rooms and joining

- The DM presses "New game" and gets a 6-character room code and a
  private DM link. The DM link holds a long secret and is remembered in
  that browser.
- Players open the player link, or go to the site and type the code.
  They land straight on the map.
- A game holds many maps. One is "live", and that is the one players
  see. The DM can build or edit another map privately and switch players
  to it with one button.
- The DM sees how many players are connected.
- If the DM disconnects, players keep seeing the last state. Everyone
  reconnects automatically.

### Sync

The server holds the true state of each room. The DM's browser sends
changes, the server applies them and sends each player a filtered view:
revealed cells only, no hidden tokens, no secret doors, no hidden traps,
no room names or notes. The filter is one function in `shared/`, with
tests, and it is the only path to a player.

### Not losing work

- The server saves each room to disk as JSON after changes.
- The DM's browser also keeps a full copy. If the server comes back
  empty after a restart, the DM's browser hands the room back
  automatically and players reconnect to it.
- Any map can be exported to a file and imported again.

### Keeping strangers out

- An optional host password, set on the server. When set, starting a new
  game requires it. Players never need it.
- AI generation only works with a valid DM link, and is limited to a few
  requests per minute per room.
- Rooms unused for 30 days are deleted.

## What the screens look like

DM screen (laptop):

```
+----------------------------------------------------------+----------+
| Game ABC123 [Copy player link]   3 watching   Map: Crypt | GENERATE |
+----------------------------------------------------------+ [flooded |
|  Tools: Select  Paint  Door  Object  Fog  Ruler   Undo   |  crypt.. |
|                                                          | [AI][Dice|
|        ####################                              +----------+
|        #......#...........#    (map canvas, pan + zoom,  | TOKENS   |
|        #..(G).+....[E]....#     fog shown as a tint)     | + Add    |
|        #......#...........#                              | G Gimble |
|        ####################                              | E Ghoul x|
|                                                          +----------+
|                                                          | MAPS     |
|                                                          | Crypt*   |
|                                                          | Tavern   |
+----------------------------------------------------------+----------+
```

Player screen (phone): the map fills the screen. Pinch to zoom, drag to
pan, tap two spots to measure. A small bar shows the map name and a
"5 ft" scale. Nothing else.

## Checking it works

- Unit tests for the generators (every room reachable, same seed gives
  same map), the plan checks (bad AI output still yields a valid map),
  the player-view filter and the distance maths.
- An end-to-end test with a real server, one DM browser and two player
  browsers: a token move reaches both players, a hidden token and
  unrevealed cells are absent from what players receive, switching the
  live map updates players, and a restarted server gets its room back
  from the DM's browser.

## Left to the builder

- UI library for the side panels, and the exact canvas drawing style.
  The bar to clear: it should look like a battle map, not a spreadsheet.
- Whether token moves stream while dragging or animate on drop.
- The exact structure of sync messages.
- Which Claude model the AI generator calls, and its prompt.
- Deployment files for a free host, and README steps for hosting and
  for running on a laptop.

## Possible later

Initiative order, a DM "ping" that flashes a spot for players, area
templates for spells, status markers on tokens, player-controlled
tokens as an opt-in.
