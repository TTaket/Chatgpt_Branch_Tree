import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await copyFile("public/manifest.json", "dist/manifest.json");

await Promise.all(["dist/content.js", "dist/pageBridge.js"].map(wrapScriptInFunctionScope));

async function wrapScriptInFunctionScope(filePath) {
  const source = await readFile(filePath, "utf8");
  if (/^\s*import\s/m.test(source)) {
    throw new Error(`${filePath} still contains ESM imports; content/page-world scripts must be self-contained.`);
  }
  if (source.startsWith("(() => {")) return;
  await writeFile(filePath, `(() => {\n${source}\n})();\n`);
}
