import { esc } from "./format";
import { fetchRound, fetchTopBroadcasts, parseLichessUrl, type RoundInfo } from "./lichess";
import { readSettings } from "./settings";

function go(params: Record<string, string>) {
  const { style, theme, palette } = readSettings();
  location.search = new URLSearchParams({ ...params, style, theme, palette }).toString();
}

export async function showPicker(parent: HTMLElement, roundId?: string) {
  parent.innerHTML = `
    <main class="picker">
      <header>
        <img src="${import.meta.env.BASE_URL}ChessArt_Logo_White.png" alt="" />
        <div><h1>ChessArt Live</h1><p>Watch a game turn into art, move by move.</p></div>
        <nav class="tool-links">
          <a class="tool-link" href="./flower-key.jpg" target="_blank" rel="noopener">Flower key</a>
          <a class="tool-link" href="./animate/">Make a video →</a>
        </nav>
      </header>
      <form class="link">
        <input name="url" placeholder="Paste a Lichess broadcast or game link" autocomplete="off" />
        <button>Open</button>
      </form>
      <p class="error" hidden></p>
      <section class="list"><p class="muted">Loading live events…</p></section>
    </main>`;
  const list = parent.querySelector<HTMLElement>(".list")!;
  const error = parent.querySelector<HTMLElement>(".error")!;

  parent.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const target = parseLichessUrl(new FormData(e.target as HTMLFormElement).get("url") as string);
    if (!target) {
      error.hidden = false;
      error.textContent = "That doesn't look like a Lichess broadcast or game link.";
      return;
    }
    if (target.kind === "game") go({ lichess: target.gameId });
    else if (target.gameId) go({ round: target.roundId, game: target.gameId });
    else showRound(list, target.roundId);
  });

  if (roundId) return showRound(list, roundId);

  try {
    const { active } = await fetchTopBroadcasts();
    list.innerHTML = `<h2>Live and recent events</h2>
      <ul class="events">${active
        .map(
          (b) => `<li><button data-round="${esc(b.round.id)}">
            <span class="name">${esc(b.tour.name)}</span>
            <span class="sub">${esc(b.round.name)}${b.tour.info?.location ? ` · ${esc(b.tour.info.location)}` : ""}</span>
            ${b.round.ongoing ? `<span class="live">Live</span>` : ""}
          </button></li>`,
        )
        .join("")}</ul>`;
    list.querySelectorAll<HTMLButtonElement>("[data-round]").forEach((b) =>
      b.addEventListener("click", () => showRound(list, b.dataset.round!)),
    );
  } catch {
    list.innerHTML = `<p class="muted">Couldn't reach Lichess. Paste a link above or try again.</p>`;
  }
}

async function showRound(list: HTMLElement, roundId: string) {
  list.innerHTML = `<p class="muted">Loading games…</p>`;
  let info: RoundInfo;
  try {
    info = await fetchRound(roundId);
  } catch {
    list.innerHTML = `<p class="muted">Couldn't load that round.</p>`;
    return;
  }
  const player = (p?: { name: string; title?: string; rating?: number }) =>
    p ? `${p.title ? `<b>${esc(p.title)}</b> ` : ""}${esc(p.name)}${p.rating ? ` <span class="rating">${p.rating}</span>` : ""}` : "";
  list.innerHTML = `<h2>${esc(info.tour.name)} · ${esc(info.round.name)}</h2>
    <ul class="games">${info.games
      .map(
        (g) => `<li><button data-game="${esc(g.id)}">
          <span class="white">${player(g.players?.[0])}</span>
          <span class="status">${g.status && g.status !== "*" ? esc(g.status) : "Playing"}</span>
          <span class="black">${player(g.players?.[1])}</span>
        </button></li>`,
      )
      .join("")}</ul>`;
  list.querySelectorAll<HTMLButtonElement>("[data-game]").forEach((b) =>
    b.addEventListener("click", () => go({ round: roundId, game: b.dataset.game! })),
  );
}
