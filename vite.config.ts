import { defineConfig } from "vite";
import { resolve } from "node:path";

// Multi-page build: the game plus the website pages.
const pages = ["about", "how-to-play", "news", "leaderboard", "contact", "privacy"];

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        ...Object.fromEntries(pages.map((p) => [p, resolve(__dirname, `pages/${p}.html`)])),
      },
    },
  },
});
