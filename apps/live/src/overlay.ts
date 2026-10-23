import { palettes, styles, themes } from "@chessart/render";
import { esc } from "./format";
import type { Settings } from "./settings";

// OBS browser-source mode (?obs=1): only the art, sized to the source, for laying over a stream.
export interface Overlay {
  transparent: boolean;
  start: "first" | "now"; // replay the game from move 1, or open on the position as it stands
}

export function readOverlay(params = new URLSearchParams(location.search)): Overlay | null {
  if (params.get("obs") !== "1") return null;
  return {
    transparent: params.get("bg") !== "solid",
    start: params.get("start") === "now" ? "now" : "first",
  };
}

// The viewer's own link, with its game and look, switched to overlay mode.
export function overlayUrl(settings: Settings, overlay: Overlay): string {
  const params = new URLSearchParams(location.search);
  params.set("style", settings.style);
  params.set("theme", settings.theme);
  params.set("palette", settings.palette);
  params.set("obs", "1");
  params.set("bg", overlay.transparent ? "transparent" : "solid");
  params.set("start", overlay.start);
  for (const key of ["panel", "labels"]) params.delete(key);
  return `${location.origin}${location.pathname}?${params}`;
}

// The "OBS link" dialog. Style and colour changes apply to the viewer behind it straight away,
// so the screen is the preview; `onChange` hands them back to the viewer.
export function openObsDialog(root: HTMLElement, settings: Settings, onChange: (s: Settings) => void) {
  const overlay: Overlay = { transparent: true, start: "first" };
  const dialog = document.createElement("dialog");
  dialog.className = "obs";
  root.append(dialog);

  const chip = (group: string, value: string, label: string, on: boolean) =>
    `<button type="button" class="chip" data-group="${group}" data-value="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;

  const render = () => {
    const bg = overlay.transparent ? "transparent" : settings.theme;
    dialog.innerHTML = `
      <form method="dialog">
        <header>
          <h2>OBS browser source</h2>
          <button class="close" aria-label="Close">×</button>
        </header>
        <p class="lede">Paste this link into a Browser Source in OBS. The game draws itself as art over your stream, move by move as it's played.</p>
        <fieldset><legend>Style</legend>${styles.map((s) => chip("style", s.id, s.name, s.id === settings.style)).join("")}</fieldset>
        <fieldset><legend>Colours</legend>${palettes.map((p) => chip("palette", p.id, p.name, p.id === settings.palette)).join("")}</fieldset>
        <fieldset><legend>Background</legend>${chip("bg", "transparent", "Transparent", bg === "transparent")}${themes
          .map((t) => chip("bg", t.id, t.name, bg === t.id))
          .join("")}</fieldset>
        <fieldset><legend>Start</legend>${chip("start", "first", "Replay from move 1", overlay.start === "first")}${chip(
          "start",
          "now",
          "Show the game so far",
          overlay.start === "now",
        )}</fieldset>
        <div class="copy">
          <input readonly value="${esc(overlayUrl(settings, overlay))}" aria-label="Browser source link" />
          <button type="button" class="primary" data-copy>Copy link</button>
        </div>
        <p class="tip">In OBS: Sources → + → Browser, paste the link and set the size to 1080 × 1080. The art stays square and centred whatever size you choose.</p>
      </form>`;
  };

  dialog.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    if (target === dialog) return dialog.close(); // a click on the backdrop
    if (target.closest("[data-copy]")) {
      const input = dialog.querySelector("input")!;
      const button = target.closest<HTMLButtonElement>("[data-copy]")!;
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand("copy");
      }
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy link"), 1800);
      return;
    }
    const pick = target.closest<HTMLElement>("[data-group]");
    if (!pick) return;
    const value = pick.dataset.value!;
    switch (pick.dataset.group) {
      case "style": {
        const style = styles.find((s) => s.id === value)!;
        settings = { ...settings, style: style.id, theme: style.defaults?.theme ?? settings.theme, palette: style.defaults?.palette ?? settings.palette };
        break;
      }
      case "palette":
        settings = { ...settings, palette: value };
        break;
      case "bg":
        overlay.transparent = value === "transparent";
        if (!overlay.transparent) settings = { ...settings, theme: value };
        break;
      case "start":
        overlay.start = value as Overlay["start"];
        break;
    }
    onChange(settings);
    render();
  });
  dialog.addEventListener("close", () => dialog.remove());

  render();
  dialog.showModal();
}
