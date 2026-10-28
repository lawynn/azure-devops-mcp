import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCredentialProvider, ADO_RESOURCE, ADO_SCOPE } from "../src/auth.js";
import { publicError } from "../src/errors.js";
import { run, type Runner } from "../src/process.js";
import type { Context } from "../src/context.js";

const context: Context = { organization: "one", project: "Project A", repository: "repo", profile: "test" };

test("PAT and bearer providers only use their exact environment reference", async () => {
  process.env.ADO_TEST_PAT = "fake-pat-one";
  process.env.ADO_TEST_BEARER = "fake-token-two";
  try {
    const provider = createCredentialProvider();
    const [pat, bearer] = await Promise.all([
      provider({ type: "pat", tokenEnv: "ADO_TEST_PAT", organizations: ["one"] }, context),
      provider({ type: "bearer", tokenEnv: "ADO_TEST_BEARER", organizations: ["one"] }, context),
    ]);
    assert.equal(pat.authorization, `Basic ${Buffer.from(":fake-pat-one").toString("base64")}`);
    assert.equal(bearer.authorization, "Bearer fake-token-two");
    await assert.rejects(provider({ type: "pat", tokenEnv: "ADO_TEST_MISSING", organizations: ["one"] }, context), /environment/);
    await assert.rejects(provider({ type: "pat", tokenEnv: "ADO_TEST_PAT", organizations: ["two"] }, context), /does not allow/);
  } finally { delete process.env.ADO_TEST_PAT; delete process.env.ADO_TEST_BEARER; }
});

test("concurrent Azure CLI profiles have isolated per-process directories and explicit selectors", async () => {
  const calls: { args: string[]; dir: string | undefined }[] = [];
  const runner: Runner = async (_command, args, options) => {
    calls.push({ args, dir: options?.env?.AZURE_CONFIG_DIR });
    await new Promise((resolve) => setTimeout(resolve, 5));
    return JSON.stringify({ accessToken: options?.env?.AZURE_CONFIG_DIR?.endsWith("one") ? "token-one" : "token-two" });
  };
  const provider = createCredentialProvider(runner);
  const originalDir = process.env.AZURE_CONFIG_DIR;
  const dirOne = join(tmpdir(), "cli-one"), dirTwo = join(tmpdir(), "cli-two");
  const pythonPath = join(tmpdir(), "fake-python.exe");
  const [one, two] = await Promise.all([
    provider({ type: "azure-cli", organizations: ["one"], configDir: dirOne, tenant: "tenant-one", subscription: "sub-one", pythonPath }, context),
    provider({ type: "azure-cli", organizations: ["two"], configDir: dirTwo, tenant: "tenant-two", pythonPath }, { ...context, organization: "two" }),
  ]);
  assert.equal(one.authorization, "Bearer token-one");
  assert.equal(two.authorization, "Bearer token-two");
  assert.equal(process.env.AZURE_CONFIG_DIR, originalDir);
  assert.deepEqual(calls.map((c) => c.dir), [dirOne, dirTwo]);
  assert.ok(calls[0]!.args.includes(ADO_RESOURCE));
  assert.ok(calls[0]!.args.includes("tenant-one"));
  assert.ok(calls[0]!.args.includes("sub-one"));
  assert.ok(calls.every((c) => !c.args.includes("login") && !c.args.includes("set")));
});

test("provider errors never expose raw CLI, identity or environment secrets, and never fall back", async () => {
  let count = 0;
  const provider = createCredentialProvider(async () => { count++; throw new Error("raw-secret-token"); });
  await assert.rejects(
    provider({ type: "azure-cli", organizations: ["one"], configDir: tmpdir(), tenant: "tenant", pythonPath: join(tmpdir(), "python.exe") }, context),
    (e: unknown) => !publicError(e).includes("raw-secret-token") && publicError(e).includes("No fallback"),
  );
  assert.equal(count, 1);
  const badIdentity = createCredentialProvider(undefined, () => ({ getToken: async () => { throw new Error("private-key-secret"); } }));
  await assert.rejects(
    badIdentity({ type: "managed-identity", organizations: ["one"] }, context),
    (e: unknown) => !publicError(e).includes("private-key-secret"),
  );
  assert.equal(publicError(new Error("secret")), "Operation failed. Inspect local setup; sensitive provider details were suppressed.");
});

test("Azure Identity providers get only the selected ADO scope and an abort signal", async () => {
  const provider = createCredentialProvider(undefined, (profile) => ({
    getToken: async (scope, options) => {
      assert.equal(scope, ADO_SCOPE);
      assert.ok(options?.abortSignal);
      return { token: `fake-${profile.type}`, expiresOnTimestamp: Date.now() + 60_000 };
    },
  }));
  const common = { organizations: ["one"] };
  for (const profile of [
    { ...common, type: "client-secret" as const, tenantId: "tenant", clientId: "client", secretEnv: "FAKE" },
    { ...common, type: "client-certificate" as const, tenantId: "tenant", clientId: "client", certificatePath: join(tmpdir(), "fake.pem") },
    { ...common, type: "managed-identity" as const },
    { ...common, type: "workload-identity" as const, tenantId: "tenant", clientId: "client", tokenFilePath: join(tmpdir(), "fake-token") },
  ]) assert.equal((await provider(profile, context)).authorization, `Bearer fake-${profile.type}`);
});

test("git helper is noninteractive, repository/path/username scoped and checks returned identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ado-helper-"));
  try {
    const resolved = await realpath(dir);
    const ctx = { ...context, repoPath: dir };
    const runner: Runner = async (_command, args, options) => {
      if (args.includes("remote")) return "https://dev.azure.com/one/Project%20A/_git/repo";
      assert.ok(args.includes("credential.useHttpPath=true"));
      assert.ok(args.includes(resolved));
      assert.equal(options?.env?.GIT_TERMINAL_PROMPT, "0");
      assert.equal(options?.env?.GCM_INTERACTIVE, "never");
      assert.match(options?.input ?? "", /path=one\/Project%20A\/_git\/repo/);
      assert.match(options?.input ?? "", /username=test@example.invalid/);
      return "username=test@example.invalid\npassword=fake-git-secret";
    };
    const profile = { type: "git-helper" as const, organizations: ["one"], username: "test@example.invalid" };
    assert.equal((await createCredentialProvider(runner)(profile, ctx)).authorization,
      `Basic ${Buffer.from("test@example.invalid:fake-git-secret").toString("base64")}`);
    const mismatch: Runner = async (...args) => args[1].includes("remote") ? runner(...args) : "username=someone-else\npassword=secret";
    await assert.rejects(createCredentialProvider(mismatch)(profile, ctx), /configured username/);
    await assert.rejects(createCredentialProvider(runner)(profile, context), /requires repoPath/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("subprocess failure output is suppressed", async () => {
  await assert.rejects(run(process.execPath, ["-e", "process.stderr.write('fake-secret');process.exit(1)"]),
    (error: unknown) => !publicError(error).includes("fake-secret"));
});
