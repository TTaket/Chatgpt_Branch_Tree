import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, "src/panel/sidepanel.html"),
        background: resolve(__dirname, "src/background/background.ts"),
        content: resolve(__dirname, "src/content/content.ts"),
        pageBridge: resolve(__dirname, "src/page-bridge/pageBridge.ts")
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background.js";
          if (chunk.name === "content") return "content.js";
          if (chunk.name === "pageBridge") return "pageBridge.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    environmentOptions: {
      jsdom: {
        url: "https://chatgpt.com/project/demo/c/chat-1"
      }
    },
    setupFiles: []
  }
});
