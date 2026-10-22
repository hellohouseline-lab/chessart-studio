import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/montserrat/400-italic.css";
import "./style.css";
import { fetchRound, watchBroadcast, watchGame } from "./lichess";
import { showPicker } from "./picker";
import { readSettings } from "./settings";
import { Viewer } from "./viewer";

const app = document.getElementById("app")!;
const params = new URLSearchParams(location.search);
const round = params.get("round");
const game = params.get("game");
const lichessGame = params.get("lichess");

if (round && game) {
  const viewer = new Viewer(app, readSettings());
  fetchRound(round)
    .then((info) => {
      const g = info.games.find((x) => x.id === game);
      viewer.setHeading({
        title: info.tour.name,
        subtitle: [info.round.name, info.tour.info?.location].filter(Boolean).join(" · "),
        fed: { w: g?.players?.[0]?.fed, b: g?.players?.[1]?.fed },
      });
    })
    .catch(() => {}); // the PGN tags still give us names and the event
  watchBroadcast(round, game, viewer.handlers);
} else if (lichessGame) {
  const viewer = new Viewer(app, readSettings());
  watchGame(lichessGame, viewer.handlers);
} else {
  showPicker(app, round ?? undefined);
}
