// Renders games to PNG for reviewing styles at full resolution (and checking print output).
//   npm run snapshot -- --out <dir> [--style id] [--game "The Immortal Game"] [--theme id]
//                       [--palette id] [--size 1600] [--progress 10.5] [--pgn file.pgn]
// Without --style/--game it renders every style × every classic game in each style's default look.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { buildScene, classicGames, parseGame, sceneToSVG, styles } from "../src/index";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ""), process.argv[i + 1] ?? "");

const out = args.get("out") ?? "snapshots";
const size = Number(args.get("size") ?? 1600);
mkdirSync(out, { recursive: true });

const games: Array<[string, string]> = args.has("pgn")
  ? [["custom", readFileSync(args.get("pgn")!, "utf8")]]
  : args.has("game")
    ? [[args.get("game")!, classicGames[args.get("game")!]!]]
    : Object.entries(classicGames);
const chosen = args.has("style") ? styles.filter((s) => s.id === args.get("style")) : styles;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

for (const style of chosen) {
  for (const [name, pgn] of games) {
    const theme = args.get("theme") ?? style.defaults?.theme ?? "dark";
    const palette = args.get("palette") ?? style.defaults?.palette ?? "classic";
    const scene = buildScene(parseGame(pgn), { style: style.id, theme, palette });
    const progress = args.has("progress") ? Number(args.get("progress")) : undefined;
    const svg = sceneToSVG(scene, { width: size, height: size, rect: { x: 0, y: 0, size }, progress });
    const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
    const file = join(out, `${style.id}--${slug(name)}--${theme}-${palette}${progress !== undefined ? `--p${progress}` : ""}.png`);
    writeFileSync(file, png);
    console.log(`${file}  (${(svg.length / 1024).toFixed(0)} KB svg, ${scene.shapes.length} moves)`);
  }
}
