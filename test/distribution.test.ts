import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("marketplace and direct GitHub installs select the same self-contained plugin root", async () => {
  const marketplace = JSON.parse(await read(".github/plugin/marketplace.json"));
  const plugin = JSON.parse(await read("plugin/plugin.json"));
  const mcp = JSON.parse(await read("plugin/mcp.json"));
  assert.equal(marketplace.plugins[0].source, "./plugin");
  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(mcp.mcpServers["azure-devops"].cwd, "${PLUGIN_ROOT}");
  assert.deepEqual(mcp.mcpServers["azure-devops"].args, ["${PLUGIN_ROOT}/server/index.js"]);
  const readme = await read("README.md");
  const skill = await read("plugin/skills/install-azure-devops-mcp/SKILL.md");
  for (const document of [readme, skill]) {
    assert.ok(document.includes("copilot plugin install lawynn/azure-devops-mcp:plugin"));
  }
  assert.ok(readme.includes("plugin/skills/install-azure-devops-mcp/SKILL.md"));
  assert.ok((await read("plugin/server/index.js")).startsWith("#!/usr/bin/env node"));
});

test("plugin skills have discoverable Agent Skills frontmatter matching directory names", async () => {
  const entries = await readdir(new URL("plugin/skills/", root), { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries.filter((entry) => entry.isDirectory())) {
    const text = await read(`plugin/skills/${entry.name}/SKILL.md`);
    const frontmatter = /^---\r?\nname: ([a-z0-9]+(?:-[a-z0-9]+)*)\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n/.exec(text);
    assert.ok(frontmatter, `Missing valid simple YAML frontmatter in ${entry.name}`);
    assert.equal(frontmatter[1], entry.name);
    assert.ok(entry.name.length <= 64);
    assert.ok(frontmatter[2]!.length > 0 && frontmatter[2]!.length <= 1024);
    assert.ok(!frontmatter[2]!.includes(": "), "Plain YAML descriptions must not contain mapping delimiters");
    names.push(entry.name);
  }
  assert.deepEqual(names.sort(), ["azure-devops", "install-azure-devops-mcp"]);
});
