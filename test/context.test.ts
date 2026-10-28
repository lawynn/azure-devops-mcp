import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSchema } from "../src/config.js";
import { normalizeOrganization, parseRemote, resolveContext } from "../src/context.js";
import { run } from "../src/process.js";

const config = configSchema.parse({
  version: 1,
  profiles: {
    org: { type: "pat", organizations: ["one"], tokenEnv: "ONE_PAT" },
    project: { type: "bearer", organizations: ["one"], tokenEnv: "ONE_PROJECT_TOKEN" },
    repo: { type: "git-helper", organizations: ["one"], username: "test@example.invalid" },
    other: { type: "pat", organizations: ["two"], tokenEnv: "TWO_PAT" },
  },
  bindings: [
    { organization: "one", profile: "org" },
    { organization: "one", project: "Project A", profile: "project" },
    { organization: "one", project: "Project A", repository: "repo", profile: "repo" },
    { organization: "two", profile: "other" },
  ],
});

test("modern, legacy, SSH and escaped-space remotes resolve consistently", () => {
  for (const remote of [
    "https://one@dev.azure.com/one/Project%20A/_git/repo",
    "https://one.visualstudio.com/Project%20A/_git/repo",
    "https://one.visualstudio.com/DefaultCollection/Project%20A/_git/repo",
    "git@ssh.dev.azure.com:v3/one/Project%20A/repo",
    "ssh://git@ssh.dev.azure.com/v3/one/Project%20A/repo",
  ]) assert.deepEqual(parseRemote(remote), { organization: "one", project: "Project A", repository: "repo" });
  assert.equal(normalizeOrganization("https://ONE.visualstudio.com/"), "one");
  assert.equal(normalizeOrganization("https://dev.azure.com/ONE/"), "one");
  assert.equal(parseRemote("https://dev.azure.com/one/project/_git/literal.git").repository, "literal.git");
});

test("unsupported hosts, secret-bearing URLs, malformed and traversing remotes are rejected", () => {
  for (const remote of [
    "https://dev.azure.com.evil.invalid/one/project/_git/repo",
    "http://dev.azure.com/one/project/_git/repo",
    "https://user:secret@dev.azure.com/one/project/_git/repo",
    "https://dev.azure.com/one/project/_git/repo?password=secret",
    "https://dev.azure.com/one/project/_git/repo#fragment",
    "https://dev.azure.com/one/project/_git/%2fetc",
    "https://dev.azure.com/one/../two/project/_git/repo",
    "https://dev.azure.com/one/%2e%2e/two/project/_git/repo",
    "https://dev.azure.com\\one\\project\\_git\\repo",
    "git@ssh.dev.azure.com:v3/one/project/%2e%2e",
    "https://github.com/one/project",
    "https://dev.azure.com/one/project/_git/repo\n",
  ]) assert.throws(() => parseRemote(remote), { name: "Error" });
  for (const org of ["https://dev.azure.com.evil.invalid/one", "https://user@dev.azure.com/one", "https://dev.azure.com/one/extra", "one/../two", "https://dev.azure.com/one/../two"]) {
    assert.throws(() => normalizeOrganization(org));
  }
});

test("explicit profile then repository/project/organization precedence", async () => {
  assert.equal((await resolveContext(config, { organization: "one" })).profile, "org");
  assert.equal((await resolveContext(config, { organization: "one", project: "Project A" })).profile, "project");
  assert.equal((await resolveContext(config, { organization: "one", project: "project a", repository: "REPO" })).profile, "repo");
  assert.equal((await resolveContext(config, { organization: "one", project: "Project A", repository: "repo", profile: "org" })).profile, "org");
  await assert.rejects(resolveContext(config, { organization: "two", profile: "org" }), /not allowed/);
  await assert.rejects(resolveContext(config, {}), /does not guess/);
  await assert.rejects(resolveContext(config, { organization: "unknown" }), /No unique/);
});

test("equally specific different identities fail closed; duplicate same-profile bindings are harmless", async () => {
  const ambiguous = structuredClone(config);
  ambiguous.bindings.push({ organization: "one", profile: "project" });
  await assert.rejects(resolveContext(ambiguous, { organization: "one" }), /No unique/);
  ambiguous.bindings.pop();
  ambiguous.bindings.push({ organization: "one", profile: "org" });
  assert.equal((await resolveContext(ambiguous, { organization: "one" })).profile, "org");
});

test("actual local git origin discovery and explicit-target conflict detection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ado-context-"));
  try {
    await run("git", ["init", "--quiet", dir]);
    await run("git", ["-C", dir, "remote", "add", "origin", "https://dev.azure.com/one/Project%20A/_git/repo"]);
    const result = await resolveContext(config, { repoPath: dir });
    assert.equal(result.organization, "one");
    assert.equal(result.profile, "repo");
    await assert.rejects(resolveContext(config, { repoPath: dir, organization: "two" }), /conflicts/);
    await assert.rejects(resolveContext(config, { repoPath: dir, repository: "different" }), /conflicts/);
    await assert.rejects(resolveContext(config, { repoPath: "relative" }), /absolute/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("configuration disallows literal secrets, invalid references, bad bindings and relative credential paths", () => {
  const base = { version: 1, bindings: [] };
  for (const profile of [
    { type: "pat", organizations: ["one"], token: "never-allowed" },
    { type: "pat", organizations: ["one"], tokenEnv: "invalid-name" },
    { type: "azure-cli", organizations: ["one"], configDir: "relative", tenant: "tenant" },
  ]) assert.equal(configSchema.safeParse({ ...base, profiles: { profile } }).success, false);
  assert.equal(configSchema.safeParse({ ...config, bindings: [{ organization: "two", profile: "org" }] }).success, false);
  assert.equal(configSchema.safeParse({ ...config, bindings: [{ organization: "one", repository: "repo", profile: "org" }] }).success, false);
});
