import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const local = process.argv.includes("--local");
const temporary = await mkdtemp(join(tmpdir(), "ado-install-"));
const expectedHash = createHash("sha256").update(await readFile(join(root, "plugin", "server", "index.js"))).digest("hex");
const cli = process.env.COPILOT_BINARY || "copilot";
const cliPrefix = process.env.COPILOT_SMOKE_VERSION ? ["--prefer-version", process.env.COPILOT_SMOKE_VERSION] : [];

async function environment(name) {
  const home = join(temporary, name);
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "LOCALAPPDATA"].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : []));
  Object.assign(env, {
    HOME: home, USERPROFILE: home, COPILOT_HOME: join(home, "copilot"),
    APPDATA: join(home, "appdata"),
    XDG_CONFIG_HOME: join(home, "xdg"), TEMP: join(home, "tmp"), TMP: join(home, "tmp"),
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_ASKPASS: "",
    COPILOT_AUTO_UPDATE: "false", CI: "true",
  });
  await Promise.all([home, env.COPILOT_HOME, env.APPDATA, env.XDG_CONFIG_HOME, env.TEMP]
    .map((path) => mkdir(path, { recursive: true })));
  await writeFile(env.GIT_CONFIG_GLOBAL, "");
  return { home, env };
}

async function command(binary, args, setup) {
  const { stdout } = await execute(binary, binary === cli ? [...cliPrefix, ...args] : args, {
    cwd: setup.home, env: setup.env, shell: false, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function installedRoot(directory, depth = 0) {
  assert.ok(depth < 12, "Unexpected plugin installation nesting");
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.name === "plugin.json")) {
    const manifest = JSON.parse(await readFile(join(directory, "plugin.json"), "utf8"));
    if (manifest.name === "azure-devops") return directory;
  }
  for (const entry of entries.filter((entry) => entry.isDirectory() && entry.name !== ".git")) {
    const found = await installedRoot(join(directory, entry.name), depth + 1);
    if (found) return found;
  }
}

async function userPlugins(setup) {
  const list = JSON.parse(await command(cli, ["plugin", "list", "--json"], setup));
  assert.ok(Array.isArray(list));
  return list.filter((plugin) => plugin.source !== "builtin");
}

async function verifyPlugin(setup, liveSource) {
  const list = await userPlugins(setup);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "azure-devops");
  assert.equal(list[0].enabled, true);
  const plugin = liveSource ?? await installedRoot(setup.env.COPILOT_HOME);
  assert.ok(plugin, "CLI did not install the plugin in its isolated home");
  if (liveSource) assert.equal(await realpath(plugin), await realpath(join(root, "plugin")));
  else assert.ok((await realpath(plugin)).startsWith((await realpath(temporary)) + sep));
  const hash = createHash("sha256").update(await readFile(join(plugin, "server", "index.js"))).digest("hex");
  assert.equal(hash, expectedHash, "Installed runtime differs from this checkout");
  const skills = await command(cli, ["skill", "list", "--json"], setup);
  assert.ok(skills.includes("install-azure-devops-mcp"));
  assert.ok(skills.includes("azure-devops"));
  const mcp = JSON.parse(await readFile(join(plugin, "mcp.json"), "utf8"));
  const definition = mcp.mcpServers["azure-devops"];
  assert.equal(definition.command, "node");
  assert.deepEqual(definition.args, ["${PLUGIN_ROOT}/server/index.js"]);
  assert.equal(definition.cwd, "${PLUGIN_ROOT}");
  setup.env.ADO_MCP_CONFIG = join(setup.home, "ado-config.json");
  const bundle = join(plugin, "server", "index.js");
  await command(process.execPath, [bundle, "config", "init"], setup);
  const transport = new StdioClientTransport({
    command: process.execPath, args: [bundle], cwd: plugin, env: setup.env, stderr: "pipe",
  });
  const client = new Client({ name: "isolated-install-smoke", version: "1.0.0" });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 17);
    const result = CallToolResultSchema.parse(await client.callTool({
      name: "ado_context", arguments: { target: { organization: "example-org" } },
    }));
    assert.ok(!result.isError);
    const content = result.content[0];
    assert.ok(content?.type === "text");
    assert.deepEqual(JSON.parse(content.text), { organization: "example-org", profile: "example" });
  } finally { await client.close(); await transport.close(); }
}

try {
  const direct = await environment("direct");
  const version = await command(cli, ["--version"], direct);
  if (process.env.COPILOT_SMOKE_VERSION) assert.ok(version.includes(process.env.COPILOT_SMOKE_VERSION), "Requested version is not already cached");
  const help = await command(cli, ["plugin", "list", "--help"], direct);
  assert.ok(help.includes("--json"), "The isolated CLI lacks required plugin/skill commands. Use an installed compatible CLI; COPILOT_SMOKE_VERSION can select an already-cached version.");
  assert.deepEqual(await userPlugins(direct), []);
  await command(cli, ["plugin", "install", local ? join(root, "plugin") : "lawynn/azure-devops-mcp:plugin"], direct);
  await verifyPlugin(direct);

  const marketplace = await environment("marketplace");
  assert.deepEqual(await userPlugins(marketplace), []);
  await command(cli, ["plugin", "marketplace", "add", local ? root : "lawynn/azure-devops-mcp"], marketplace);
  await command(cli, ["plugin", "install", "azure-devops@lawynn-azure-devops"], marketplace);
  await verifyPlugin(marketplace, local ? join(root, "plugin") : undefined);

  const standalone = await environment("skill");
  const skillSource = local ? join(root, "plugin", "skills", "install-azure-devops-mcp", "SKILL.md") :
    "https://raw.githubusercontent.com/lawynn/azure-devops-mcp/main/plugin/skills/install-azure-devops-mcp/SKILL.md";
  await command(cli, ["skill", "add", skillSource], standalone);
  const skillList = await command(cli, ["skill", "list", "--json"], standalone);
  assert.ok(skillList.includes("install-azure-devops-mcp"));
  assert.deepEqual(await userPlugins(standalone), []);
  console.log(JSON.stringify({
    cli: version.split("\n")[0], sources: local ? "local checkout" : "public GitHub main",
    directPlugin: "passed", marketplacePlugin: "passed", standaloneSkill: "passed",
    stdioInitializeListCall: "passed", userConfiguration: "not modified", azureDevOpsRequests: 0,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
