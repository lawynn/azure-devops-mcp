import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { SafeError } from "./errors.js";

export const segment = z.string().min(1).max(256).refine(
  (s) => !/[/\\%?#\u0000-\u001f\u007f]/u.test(s) && s !== "." && s !== "..",
  "Expected a single, unescaped path segment",
);
export const orgName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,49}$/).transform((s) => s.toLowerCase());
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const absolutePath = z.string().min(1).refine((p) => isAbsolute(p) && !/[\u0000-\u001f]/u.test(p), "Expected absolute path");
const selector = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,255}$/);
const common = { organizations: z.array(orgName).min(1) };
const profileSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...common, type: z.literal("pat"), tokenEnv: envName }),
  z.strictObject({ ...common, type: z.literal("bearer"), tokenEnv: envName }),
  z.strictObject({
    ...common, type: z.literal("azure-cli"), configDir: absolutePath,
    tenant: selector, subscription: selector.optional(), pythonPath: absolutePath.optional(),
  }),
  z.strictObject({
    ...common, type: z.literal("client-secret"), tenantId: selector, clientId: selector, secretEnv: envName,
  }),
  z.strictObject({
    ...common, type: z.literal("client-certificate"), tenantId: selector, clientId: selector,
    certificatePath: absolutePath,
  }),
  z.strictObject({
    ...common, type: z.literal("managed-identity"), clientId: selector.optional(),
  }),
  z.strictObject({
    ...common, type: z.literal("workload-identity"), tenantId: selector, clientId: selector,
    tokenFilePath: absolutePath,
  }),
  z.strictObject({
    ...common, type: z.literal("git-helper"),
    username: z.string().regex(/^[a-zA-Z0-9@._+-]{1,256}$/),
  }),
]);
export const configSchema = z.strictObject({
  version: z.literal(1),
  profiles: z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), profileSchema),
  bindings: z.array(z.strictObject({
    organization: orgName, project: segment.optional(), repository: segment.optional(),
    profile: z.string().min(1),
  })).max(1000),
}).superRefine((config, ctx) => {
  for (const [i, binding] of config.bindings.entries()) {
    const profile = config.profiles[binding.profile];
    if (!profile || !profile.organizations.includes(binding.organization) || (binding.repository && !binding.project)) {
      ctx.addIssue({ code: "custom", path: ["bindings", i], message: "Invalid profile scope or repository binding without project" });
    }
  }
});
export type Config = z.infer<typeof configSchema>;
export type Profile = Config["profiles"][string];

export function configPath(): string {
  const override = process.env.ADO_MCP_CONFIG;
  if (override) {
    if (!isAbsolute(override)) throw new SafeError("ADO_MCP_CONFIG must be an absolute path.");
    return override;
  }
  return join(process.env.APPDATA || join(homedir(), ".config"), "azure-devops-mcp", "config.json");
}

export async function loadConfig(path = configPath()): Promise<Config> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch { throw new SafeError("Configuration unavailable. Run config init or set ADO_MCP_CONFIG to an absolute config file path."); }
  if (Buffer.byteLength(text) > 1024 * 1024) throw new SafeError("Configuration exceeds 1 MiB.");
  let input: unknown;
  try { input = JSON.parse(text); }
  catch { throw new SafeError("Configuration is not valid JSON."); }
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new SafeError("Invalid configuration. Check profile types, environment references, absolute paths and bindings against docs/configuration.md.");
  return parsed.data;
}

export function describeConfig(config: Config) {
  return {
    version: config.version,
    profiles: Object.entries(config.profiles).map(([name, p]) => ({ name, type: p.type, organizations: p.organizations })),
    bindings: config.bindings,
  };
}

export async function initConfig(path = configPath()) {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, JSON.stringify({
      version: 1,
      profiles: { example: { type: "pat", organizations: ["example-org"], tokenEnv: "ADO_EXAMPLE_PAT" } },
      bindings: [{ organization: "example-org", profile: "example" }],
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } catch { throw new SafeError("Could not create configuration. Existing files are never overwritten; check path and permissions."); }
  return { created: true };
}
