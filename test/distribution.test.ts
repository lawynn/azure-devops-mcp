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

test("installation guide targets the invoking host and separates registration from live readiness", async () => {
  const skill = await read("plugin/skills/install-azure-devops-mcp/SKILL.md");
  for (const required of [
    "client hosting this conversation", "execution host", "same local",
    "effective Copilot configuration directory", "stop registration",
    "Customize → MCP", "copilot mcp add lawynn-azure-devops",
    "registered, tools not loaded in this conversation",
    "runtime installed; client registered; credentials", "never `--show-secrets`",
    "plugin/mcp.json", "identical registration exists", "preserve",
  ]) assert.ok(skill.toLowerCase().includes(required.toLowerCase()), `Missing installation safeguard: ${required}`);
  const match = /--tools ([a-z_,]+) --/.exec(skill);
  assert.ok(match);
  const tools = match[1]!.split(",");
  assert.ok(tools.includes("ado_config") && tools.includes("ado_context"));
  assert.ok(!tools.some((name) => /create|update|^ado_pipeline_run$/.test(name)));
});

test("documented JSON registration matches the standalone command and avoids existing server identities", async () => {
  const skill = await read("plugin/skills/install-azure-devops-mcp/SKILL.md");
  const code = /```json\r?\n([\s\S]*?)\r?\n```/.exec(skill);
  assert.ok(code);
  const json = JSON.parse(code[1]!);
  assert.deepEqual(Object.keys(json.mcpServers), ["lawynn-azure-devops"]);
  const entry = json.mcpServers["lawynn-azure-devops"];
  assert.equal(entry.type, "local");
  assert.equal(entry.args.length, 1);
  assert.ok(entry.args[0].endsWith("\\plugin\\server\\index.js"));
  assert.deepEqual(Object.keys(entry.env), ["ADO_MCP_CONFIG"]);
  assert.deepEqual(entry.tools, /--tools ([a-z_,]+) --/.exec(skill)![1]!.split(","));
  for (const required of [
    "<COPILOT_HOME>/mcp-config.json", "~/.copilot/mcp-config.json",
    "explicit project scope", ".github/mcp.json", "atomically",
    "same host verification and policy boundaries",
  ]) assert.ok(skill.includes(required));
});
