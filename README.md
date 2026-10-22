# ChessArt Studio

Every chess move drawn as a curved, gradient-filled arc from its square of origin to its destination. One renderer powers every ChessArt tool.

| Path | What it is |
| --- | --- |
| `packages/render` | The shared renderer: PGN → scene → canvas or SVG, with move-by-move drawing. Styles, themes and palettes live here. |
| `apps/live` | Live exhibition viewer: a Lichess broadcast or game drawn as it is played. |

The Classic Arcs geometry is ported from the original ChessArt generator (`chess-art/js/chessArt.js`, Jamie Leb). It's checked against the original print SVGs in `packages/render/test`.

## Run it

```bash
npm install
npm test          # renderer tests, including the print-artwork regression
npm run dev:live  # live viewer on http://localhost:5173
```

## Live viewer

Open the viewer and pick an event, or paste a Lichess link: a broadcast game (`lichess.org/broadcast/<tour>/<round>/<roundId>/<gameId>`) or a regular game (`lichess.org/<gameId>`).

Each game has its own URL, for example `?round=<roundId>&game=<gameId>&theme=dark-checkers&palette=classic`. Point the exhibition screen at that URL; reloading it resumes the game.

| Key | Action |
| --- | --- |
| F | Full screen |
| T | Next theme (Dark, Light, Dark Checkers, Light Checkers) |
| P | Next palette (Classic, Aurora, Ember, Noir, Neon) |
| H | Hide/show the side panel |
| L | Hide/show board labels |
| B | Back to the event picker |

How it behaves:
- Moves already played sweep in over about 5 seconds. Each new move then sweeps in over about 1.6 seconds.
- Clocks come from the broadcast's `%clk` times. Lichess broadcasts usually run on a delay, so the screen is as live as Lichess is.
- The screen stays awake, and the cursor hides after 2.5 seconds without movement.
- If the connection drops, the viewer reconnects on its own. After a Lichess rate limit (HTTP 429) it waits a full minute, as Lichess asks.
- When the game ends, the viewer shows the result and stops listening.

## Publishing the live viewer

The viewer is a static site. `.github/workflows/live-pages.yml` runs the tests, builds it and publishes it to GitHub Pages on every push to `main`. One-time setup: in the repo, go to Settings → Pages → Source and choose **GitHub Actions**.

The build uses relative paths, so it works both at `<user>.github.io/<repo>/` and on a custom domain. For `live.chessart.me`:
1. Add a CNAME record for `live` pointing to `<user>.github.io` (in IONOS, where chessart.me's DNS lives).
2. Enter `live.chessart.me` under Settings → Pages → Custom domain.

## Adding a style

Implement `ArtStyle` from `packages/render/src/scene.ts`: turn an `ArtGame` into a `Scene` of lens shapes. Then register it in `packages/render/src/index.ts`. Every tool picks up new styles automatically.
