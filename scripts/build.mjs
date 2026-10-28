import { build } from "esbuild";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { builtinModules } from "node:module";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({
  absWorkingDir: root, entryPoints: ["src/index.ts"], bundle: true,
  platform: "node", target: "node22", format: "esm", minify: true,
  legalComments: "eof", write: false, metafile: true,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const output = result.outputFiles[0].contents;
for (const info of Object.values(result.metafile.outputs)) {
  for (const imported of info.imports) {
    if (imported.external && !builtinModules.includes(imported.path.replace(/^node:/, ""))) {
      throw new Error(`Unexpected external runtime dependency: ${imported.path}`);
    }
  }
}
const path = new URL("../plugin/server/index.js", import.meta.url);
const digest = createHash("sha256").update(output).digest("hex") + "\n";
const packages = new Set(Object.keys(result.metafile.inputs).flatMap((input) => {
  const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input.replaceAll("\\", "/"));
  return match ? [match[1]] : [];
}));
const notices = [];
for (const name of [...packages].sort()) {
  const dir = join(root, ...name.split("/"));
  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  const licenses = (await readdir(dir)).filter((f) => /^(license|licence|notice)(\.|$)/i.test(f)).sort();
  if (!licenses.length) throw new Error(`Missing bundled dependency license: ${name}`);
  const texts = await Promise.all(licenses.map(async (file) =>
    (await readFile(join(dir, file), "utf8")).replaceAll("\r\n", "\n").replace(/[ \t]+$/gm, "")));
  notices.push(`${pkg.name}@${pkg.version}\n${texts.join("\n")}`);
}
const files = [
  [path, output],
  [new URL("../plugin/server/index.js.sha256", import.meta.url), digest],
  [new URL("../plugin/THIRD-PARTY-NOTICES.txt", import.meta.url), notices.join("\n\n--------------------\n\n") + "\n"],
  [new URL("../plugin/LICENSE", import.meta.url), await readFile(new URL("../LICENSE", import.meta.url))],
];
if (process.argv.includes("--check")) {
  for (const [file, contents] of files) {
    if (!Buffer.from(contents).equals(await readFile(file))) {
      throw new Error("Committed plugin bundle or licenses are stale. Run npm run build.");
    }
  }
  console.log("Committed bundle matches source and lockfile build.");
} else {
  await mkdir(new URL("../plugin/server/", import.meta.url), { recursive: true });
  for (const [file, contents] of files) await writeFile(file, contents, { mode: file === path ? 0o755 : 0o644 });
  console.log(`Bundled standalone plugin: ${output.length} bytes`);
}
