import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { configSchema } from "../src/config.js";
import { createServer } from "../src/server.js";
import { createCredentialProvider } from "../src/auth.js";
import { RestClient } from "../src/rest.js";
import { run } from "../src/process.js";

const config = configSchema.parse({
  version: 1,
  profiles: {
    one: { type: "pat", tokenEnv: "ADO_MCP_TEST_ONE", organizations: ["one"] },
    two: { type: "bearer", tokenEnv: "ADO_MCP_TEST_TWO", organizations: ["two"] },
  },
  bindings: [{ organization: "one", profile: "one" }, { organization: "two", profile: "two" }],
});

async function fixture(fetcher: typeof fetch, selectedConfig = config) {
  const server = createServer({ config: async () => selectedConfig, rest: new RestClient(fetcher), credentials: createCredentialProvider() });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test("concurrent different-org requests route to different credentials with no shared identity state", async () => {
  process.env.ADO_MCP_TEST_ONE = "fake-one";
  process.env.ADO_MCP_TEST_TWO = "fake-two";
  const seen: { org: string; auth: string | null }[] = [];
  const { client, close } = await fixture(async (input, options) => {
    const url = new URL(String(input));
    const headers = new Headers(options?.headers);
    seen.push({ org: url.pathname.split("/")[1]!, auth: headers.get("Authorization") });
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json({ value: [{ name: url.pathname.split("/")[1] }] });
  });
  try {
    const results = await Promise.all(["one", "two", "one", "two"].map((organization) =>
      client.callTool({ name: "ado_projects_list", arguments: { target: { organization } } })));
    assert.ok(results.every((r) => !r.isError));
    for (const item of seen) assert.equal(item.auth,
      item.org === "one" ? `Basic ${Buffer.from(":fake-one").toString("base64")}` : "Bearer fake-two");
    assert.equal(seen.length, 4);
  } finally { await close(); delete process.env.ADO_MCP_TEST_ONE; delete process.env.ADO_MCP_TEST_TWO; }
});

test("concurrent same-organization repository bindings keep distinct accounts", async () => {
  const scoped = configSchema.parse({
    ...config,
    profiles: {
      ...config.profiles,
      automation: { type: "bearer", tokenEnv: "ADO_MCP_TEST_AUTOMATION", organizations: ["one"] },
    },
    bindings: [...config.bindings, { organization: "one", project: "project", repository: "automation", profile: "automation" }],
  });
  process.env.ADO_MCP_TEST_ONE = "fake-one";
  process.env.ADO_MCP_TEST_AUTOMATION = "fake-automation";
  const seen = new Map<string, string | null>();
  const { client, close } = await fixture(async (input, options) => {
    seen.set(new URL(String(input)).pathname, new Headers(options?.headers).get("Authorization"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json({ value: [] });
  }, scoped);
  try {
    await Promise.all(["personal", "automation"].map((repository) =>
      client.callTool({ name: "ado_pull_requests_list", arguments: { target: { organization: "one", project: "project", repository } } })));
    assert.equal(seen.get("/one/project/_apis/git/repositories/personal/pullrequests"), `Basic ${Buffer.from(":fake-one").toString("base64")}`);
    assert.equal(seen.get("/one/project/_apis/git/repositories/automation/pullrequests"), "Bearer fake-automation");
  } finally { await close(); delete process.env.ADO_MCP_TEST_ONE; delete process.env.ADO_MCP_TEST_AUTOMATION; }
});

test("all read surfaces produce project/repository-scoped API routes and bounded query parameters", async () => {
  process.env.ADO_MCP_TEST_ONE = "fake-one";
  const seen: { url: URL; method: string | undefined; body: BodyInit | null | undefined }[] = [];
  const { client, close } = await fixture(async (input, options) => {
    seen.push({ url: new URL(String(input)), method: options?.method, body: options?.body });
    return Response.json({ value: [] }, { headers: { "x-ms-continuationtoken": "next" } });
  });
  const target = { organization: "one", project: "project", repository: "repo" };
  try {
    const calls = [
      { name: "ado_projects_list", arguments: { target, top: 10, continuationToken: "page" } },
      { name: "ado_repositories_list", arguments: { target } },
      { name: "ado_pull_requests_list", arguments: { target, skip: 10, top: 10 } },
      { name: "ado_pull_request_get", arguments: { target, pullRequestId: 7 } },
      { name: "ado_work_item_get", arguments: { target, workItemId: 8 } },
      { name: "ado_work_items_query", arguments: { target, wiql: "SELECT [System.Id] FROM WorkItems", top: 10 } },
      { name: "ado_pipelines_list", arguments: { target, top: 10, continuationToken: "page" } },
      { name: "ado_pipeline_get", arguments: { target, pipelineId: 9 } },
      { name: "ado_pipeline_runs_list", arguments: { target, pipelineId: 9 } },
      { name: "ado_pipeline_run_get", arguments: { target, pipelineId: 9, runId: 10 } },
    ];
    for (const call of calls) assert.ok(!(await client.callTool(call)).isError);
    assert.deepEqual(seen.map((s) => s.url.pathname), [
      "/one/_apis/projects", "/one/project/_apis/git/repositories",
      "/one/project/_apis/git/repositories/repo/pullrequests",
      "/one/project/_apis/git/repositories/repo/pullrequests/7",
      "/one/project/_apis/wit/workitems/8", "/one/project/_apis/wit/wiql",
      "/one/project/_apis/pipelines", "/one/project/_apis/pipelines/9",
      "/one/project/_apis/pipelines/9/runs", "/one/project/_apis/pipelines/9/runs/10",
    ]);
    assert.equal(seen[0]!.url.searchParams.get("continuationToken"), "page");
    assert.equal(seen[2]!.url.searchParams.get("$skip"), "10");
    assert.equal(seen[5]!.method, "POST");
    assert.deepEqual(JSON.parse(String(seen[5]!.body)), { query: "SELECT [System.Id] FROM WorkItems" });
    assert.ok((await client.callTool({ name: "ado_projects_list", arguments: { target, top: 101 } })).isError);
    assert.equal(seen.length, 10);
  } finally { await close(); delete process.env.ADO_MCP_TEST_ONE; }
});

test("MCP explicit write tools produce constrained REST operations and revision guards", async () => {
  process.env.ADO_MCP_TEST_ONE = "fake-one";
  const seen: { url: URL; options: RequestInit | undefined }[] = [];
  const { client, close } = await fixture(async (input, options) => {
    seen.push({ url: new URL(String(input)), options });
    return Response.json({ id: 123, rev: 2 });
  });
  const target = { organization: "one", project: "Project A", repository: "repo" };
  try {
    const list = await client.listTools();
    assert.equal(list.tools.length, 17);
    for (const name of ["ado_pull_request_create", "ado_work_item_update", "ado_pipeline_run"]) {
      const tool = list.tools.find((t) => t.name === name)!;
      assert.equal(tool.annotations?.readOnlyHint, false);
      assert.equal(tool.annotations?.destructiveHint, true);
      assert.equal(tool.annotations?.idempotentHint, false);
    }
    const cases = [
      { name: "ado_pull_request_create", arguments: { target, title: "Test", sourceRefName: "refs/heads/feature", targetRefName: "refs/heads/main" } },
      { name: "ado_pull_request_update", arguments: { target, pullRequestId: 123, changes: { title: "Updated" } } },
      { name: "ado_work_item_create", arguments: { target, type: "Bug", fields: { "System.Title": "Test" } } },
      { name: "ado_work_item_update", arguments: { target, workItemId: 123, revision: 1, fields: { "System.Title": "Fixed" } } },
      { name: "ado_pipeline_run", arguments: { target, pipelineId: 5, refName: "refs/heads/main" } },
    ];
    for (const call of cases) assert.ok(!(await client.callTool(call)).isError);
    assert.equal(seen[0]!.options?.method, "POST");
    assert.equal(JSON.parse(String(seen[0]!.options?.body)).isDraft, true);
    assert.equal(seen[1]!.options?.method, "PATCH");
    assert.match(seen[2]!.url.pathname, /\/wit\/workitems\/%24Bug$/);
    assert.equal(new Headers(seen[2]!.options?.headers).get("Content-Type"), "application/json-patch+json");
    assert.deepEqual(JSON.parse(String(seen[3]!.options?.body))[0], { op: "test", path: "/rev", value: 1 });
    assert.deepEqual(JSON.parse(String(seen[4]!.options?.body)), { resources: { repositories: { self: { refName: "refs/heads/main" } } } });
    assert.ok((await client.callTool({ name: "ado_pull_request_update", arguments: { target, pullRequestId: 123, changes: { status: "completed" } } })).isError);
    assert.ok((await client.callTool({ name: "ado_pipeline_run", arguments: { target: { organization: "one" }, pipelineId: 5 } })).isError);
    assert.equal(seen.length, 5);
  } finally { await close(); delete process.env.ADO_MCP_TEST_ONE; }
});

test("MCP authentication failure does not retry or fall back to another profile", async () => {
  process.env.ADO_MCP_TEST_ONE = "fake-one";
  let calls = 0;
  const { client, close } = await fixture(async () => { calls++; return new Response("private response secret", { status: 403 }); });
  try {
    const result = await client.callTool({ name: "ado_projects_list", arguments: { target: { organization: "one" } } });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /No alternate identity/);
    assert.ok(!JSON.stringify(result).includes("private response secret"));
    assert.equal(calls, 1);
  } finally { await close(); delete process.env.ADO_MCP_TEST_ONE; }
});

test("actual bundled plugin initializes, lists and calls over stdio with no node_modules", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ado-plugin-"));
  const source = fileURLToPath(new URL("../plugin/", import.meta.url));
  try {
    await cp(source, join(dir, "plugin"), { recursive: true });
    const path = join(dir, "config.json");
    const manifest = JSON.parse(await readFile(join(dir, "plugin", "mcp.json"), "utf8"));
    const definition = manifest.mcpServers["azure-devops"];
    const root = join(dir, "plugin");
    const args = definition.args.map((a: string) => a.replace("${PLUGIN_ROOT}", root));
    const env = { ...process.env, ADO_MCP_CONFIG: path };
    assert.deepEqual(JSON.parse(await run(process.execPath, [...args, "config", "init"], { env })), { created: true });
    await assert.rejects(run(process.execPath, [...args, "config", "init"], { env }));
    await writeFile(path, JSON.stringify(config));
    const summary = JSON.parse(await run(process.execPath, [...args, "config", "validate"], { env }));
    assert.equal(summary.profiles.length, 2);
    assert.ok(!JSON.stringify(summary).includes("tokenEnv"));
    const transport = new StdioClientTransport({
      command: process.execPath, args, cwd: root,
      env: { ADO_MCP_CONFIG: path }, stderr: "pipe",
    });
    const client = new Client({ name: "stdio-smoke", version: "1.0.0" });
    let stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion()?.name, "azure-devops-mcp");
      assert.equal((await client.listTools()).tools.length, 17);
      const result = await client.callTool({ name: "ado_context", arguments: { target: { organization: "two", project: "project" } } });
      assert.ok(!result.isError);
      const content = CallToolResultSchema.parse(result).content[0];
      assert.ok(content?.type === "text");
      assert.deepEqual(JSON.parse(content.text), { organization: "two", profile: "two", project: "project" });
      assert.equal(stderr, "");
    } finally { await client.close(); await transport.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
