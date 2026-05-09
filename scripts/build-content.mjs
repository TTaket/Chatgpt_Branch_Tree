import { resolve } from "node:path";
import { build } from "vite";

const targets = [
  {
    entry: "src/content/content.ts",
    name: "GptbtContent",
    fileName: "content.js"
  },
  {
    entry: "src/page-bridge/pageBridge.ts",
    name: "GptbtPageBridge",
    fileName: "pageBridge.js"
  }
];

for (const target of targets) {
  await build({
    configFile: false,
    build: {
      emptyOutDir: false,
      outDir: "dist",
      sourcemap: false,
      target: "es2022",
      lib: {
        entry: resolve(target.entry),
        formats: ["iife"],
        name: target.name,
        fileName: () => target.fileName
      }
    }
  });
}
