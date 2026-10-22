import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works at a domain root (live.chessart.me)
  // or in a subfolder (GitHub Pages: <user>.github.io/<repo>/).
  base: "./",
});
