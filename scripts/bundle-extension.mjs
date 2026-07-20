import { readFile, rename, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const output = "packages/pi-extension/dist/index.js";
const temporaryOutput = `${output}.bundle`;

await build({
  entryPoints: [output],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: temporaryOutput,
  external: ["@earendil-works/pi-coding-agent"],
  legalComments: "inline",
  sourcemap: false,
  logLevel: "info",
});
await rename(temporaryOutput, output);
const bundle = await readFile(output, "utf8");
await writeFile(
  output,
  bundle.replace(/^\/\/ (?:packages|node_modules)\/.*\n/gm, ""),
);
