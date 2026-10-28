import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";

const read = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const pkg = await read("package.json");
const plugin = await read("plugin/plugin.json");
const mcp = await read("plugin/mcp.json");
const registry = await read("server.json");
for (const [document, validator] of [[plugin, Ajv2020], [mcp, Ajv2020], [registry, Ajv]]) {
  const response = await fetch(document.$schema, { signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `Schema download failed: ${document.$schema}`);
  const validate = new validator({ strict: false, validateFormats: false }).compile(await response.json());
  assert.ok(validate(document), JSON.stringify(validate.errors));
}
const marketplace = await read(".github/plugin/marketplace.json");
assert.equal(marketplace.plugins.length, 1);
assert.equal(marketplace.plugins[0].source, "./plugin");
assert.equal(marketplace.plugins[0].name, plugin.name);
assert.equal(marketplace.plugins[0].version, pkg.version);
assert.equal(plugin.version, pkg.version);
assert.equal(registry.version, pkg.version);
assert.equal(registry.name, pkg.mcpName);
assert.equal(registry.packages[0].identifier, pkg.name);
assert.equal(registry.packages[0].version, pkg.version);
assert.equal(mcp.mcpServers["azure-devops"].command, "node");
assert.deepEqual(mcp.mcpServers["azure-devops"].args, ["${PLUGIN_ROOT}/server/index.js"]);
await access(new URL("../plugin/server/index.js", import.meta.url));
console.log("Plugin/MCP/registry schemas and marketplace version/path consistency validated.");
