# ChessArt Studio

Every chess move drawn as art, from its square of origin to its destination. One renderer powers every ChessArt tool.

## Styles

| Style | Each move is… |
| --- | --- |
| **Classic Arcs** | A gradient-filled arc, as on the original prints. Heavier pieces sweep wider arcs. |
| **Brush Strokes** | A painted stroke made with intent: one committed line, either straight or a single shallow bend. Thickness comes from the piece's value (pawn 1, knight and bishop 3, rook 5, queen 9, king 4). Each stroke gets its own brush (round, filbert, flat or dry), paint load and pressure. It starts loaded and confident, then lifts off fast and dry. A capture is a heavier, dead-straight strike that ends in splatter, and both scale with the value of the piece taken. |
| **Pressed Flowers** | A gently curving stem, with a few leaves on longer moves, ending in a real flower chosen for its piece (see the key below). Each petal is drawn individually, with irregular edges, its own tint, veins, darker pressed rims and slight browning. Petals overlap translucently and cast soft shadows on grained paper. It's designed for the Paper theme and Botanical palette. |

### The Pressed Flower Key

| Piece | Flower | Why |
| --- | --- | --- |
| ♟ Pawn | Forget-me-not (*Myosotis*) | A flower of remembrance that grows in multitudes. Pawns are the many, the first to fall, and the ones to remember. |
| ♞ Knight | Larkspur (*Delphinium*) | In German it's *Rittersporn*, the knight's spur. Each floret's spur hooks back on itself, like the knight's L-shaped leap. |
| ♝ Bishop | Tulip (*Tulipa*) | Its name comes from the Persian word for turban, and its closed cup has the profile of a bishop's mitre. |
| ♜ Rook | Daisy (*Bellis perennis*) | Its petals run out in straight lines from the centre, like the rook's files and ranks. Hardy and dependable, it's always there. |
| ♛ Queen | Rose (*Rosa*) | The queen of flowers since antiquity, a title traditionally credited to Sappho. |
| ♚ King | Sunflower (*Helianthus annuus*) | The young sunflower turns to follow the sun. On the board, everything turns on the king. |

Flowers are sized by piece, from a pawn's tiny sprig of forget-me-nots up to a king's sunflower, which dominates its square (`FLOWER_SCALE` in `src/styles/flowers.ts`). Each species also varies from specimen to specimen: sprig size, closed or flaring tulips, tight or open roses, and petal counts.

`npm run key -w @chessart/render -- --out key` renders this as a printable key card (`flower-key.svg` and `flower-key.png`), using the same drawing code as the art. The published site carries it as `flower-key.jpg` (to view) and `flower-key.svg` (to print), linked from the viewer's start page. After changing a flower, regenerate it into `apps/live/public` and convert the PNG to a JPEG.

Colours follow the palette in every style: White, Black, captures, and castling. Moves follow their own hand-drawn paths (straight, a bend either way, or an S) rather than one shared arc. All randomness (paths, bristles, petals, leaves) is seeded from the move, so it's identical on every frame, reload and print.

| Path | What it is |
| --- | --- |
| `packages/render` | The shared renderer: PGN → scene → canvas or SVG, with move-by-move drawing. Styles, themes and palettes live here. |
| `apps/live` | Live exhibition viewer: a Lichess broadcast or game drawn as it is played. |
| `apps/animate` | Marketing animation tool: PGN in, move-by-move MP4 and transparent PNG sequence out. Published at `/animate/`. |

The Classic Arcs geometry is ported from the original ChessArt generator (`chess-art/js/chessArt.js`, Jamie Leb). It's checked against the original print SVGs in `packages/render/test`.

## Run it

```bash
npm install
npm test             # renderer + animation tests, including the print-artwork regression
npm run dev:live     # live viewer on http://localhost:5173
npm run dev:animate  # animation tool on http://localhost:5174
npm run build:site   # both, assembled into site/ the way GitHub Pages serves them

# Full-resolution PNGs of the classic games in every style (or pick one), via resvg, the print engine:
npm run snapshot -w @chessart/render -- --out snapshots --style pressed-flowers --size 1600
```

## Live viewer

The viewer lives at `/live/`. It isn't linked from anywhere yet and asks search engines not to index it, so only people with the link can find it.

Open the viewer and pick an event, or paste a Lichess link: a broadcast game (`lichess.org/broadcast/<tour>/<round>/<roundId>/<gameId>`) or a regular game (`lichess.org/<gameId>`).

Each game has its own URL, for example `?round=<roundId>&game=<gameId>&style=pressed-flowers&theme=paper&palette=botanical`. Point the exhibition screen at that URL; reloading it resumes the game.

| Key | Action |
| --- | --- |
| F | Full screen |
| S | Next style (switches to that style's designed theme and palette, if it has one) |
| T | Next theme (Dark, Light, Dark Checkers, Paper, Light Checkers) |
| P | Next palette (Classic, Aurora, Ember, Noir, Botanical, Neon) |
| H | Hide/show the side panel |
| L | Hide/show board labels |
| O | OBS link (see below) |
| B | Back to the event picker |

### OBS overlay

The **OBS link** button (top right, or O) gives a link to the same game as a browser source for OBS: only the art, filling the source, with no panel. Pick the style, colours and background (transparent by default, to lay over a stream) and where it starts:
- **Replay from move 1** draws the moves already played at 0.6 seconds each, then carries on live.
- **Show the game so far** opens on the current position and draws only new moves.

In OBS, add a Browser source, paste the link and set it to 1080 × 1080. The art stays square and centred at any size. The link is the viewer URL plus `obs=1&bg=transparent|solid&start=first|now`.

How it behaves:
- Moves already played sweep in over about 5 seconds. Each new move then sweeps in over about 1.6 seconds.
- Clocks come from the broadcast's `%clk` times. Lichess broadcasts usually run on a delay, so the screen is as live as Lichess is.
- The screen stays awake, and the cursor hides after 2.5 seconds without movement.
- If the connection drops, the viewer reconnects on its own. After a Lichess rate limit (HTTP 429) it waits a full minute, as Lichess asks.
- When the game ends, the viewer shows the result and stops listening.

## Animation tool

The tool takes a classic game, a pasted PGN or a Lichess game link. You choose the theme, palette, format (9:16, 4:5, 1:1, 16:9), frame rate and pacing. "Fit video to" sets the speed so the whole game lasts 15, 30 or 60 seconds.

- **Export MP4.** H.264, rendered frame by frame in the browser (needs Chrome or Edge). Faster than real time, and nothing is uploaded.
- **Export transparent PNG frames.** The frames are `frame_00001.png` … with no background, ready for After Effects or Premiere as an image sequence. In Chrome, you pick a folder and the frames are written straight into it. Other browsers download a zip instead, which holds everything in memory, so very long games are best exported from Chrome. Tick "art only" to leave out the text, board squares and labels.

## Publishing

Both tools are static sites. `.github/workflows/live-pages.yml` runs the tests, builds the site (`npm run build:site`) and publishes it to GitHub Pages on every push to `main`. The animation tool is at `/animate/` (the root forwards there) and the live viewer is at `/live/`. chessart.me carries copies of both at the same paths. One-time setup: in the repo, go to Settings → Pages → Source and choose **GitHub Actions**.

The build uses relative paths, so it works both at `<user>.github.io/<repo>/` and on a custom domain. For `live.chessart.me`:
1. Add a CNAME record for `live` pointing to `<user>.github.io` (in IONOS, where chessart.me's DNS lives).
2. Enter `live.chessart.me` under Settings → Pages → Custom domain.

## Adding a style

Implement `ArtStyle` from `packages/render/src/scene.ts`, then register it in `packages/render/src/index.ts`. Every tool picks up new styles automatically.

- `buildScene(game, { theme, palette })` turns each move into a mark. Do any random choices here, from `seeded(hashString(...))`, so they stay fixed.
- `paint(mark, rect, t)` returns vector paint ops (`PaintOp` in `paint.ts`) for the move swept to `t`: 0 is not started, 1 is finished. Build paths in board units with `PathBuilder`. The same ops draw to canvas (live viewer, animations) and to SVG (prints).
- Optionally, set `defaults: { theme, palette }` for the look the style is designed for.

`src/styles/brushStrokes.ts` and `src/styles/pressedFlowers.ts` are worked examples. `test/styles.test.ts` checks every registered style automatically: deterministic output, staying in frame, and valid SVG for print.
